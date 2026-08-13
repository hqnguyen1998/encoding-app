import { spawn } from 'node:child_process';
import type { RcloneRemote, RcloneStatus, RcloneTargetConfig, RcloneTargetResult } from '../../shared/types';
import { getRclonePath } from './binary';
import { buildRemoteBase, normalizeDestinationPath } from './upload';

interface CommandResult {
  stdout: string;
  stderr: string;
}

function lastUsefulLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join('\n');
}

export function explainRcloneFailure(stderr: string, stdout: string, code: number | null): string {
  const details = lastUsefulLines(stderr || stdout);
  if (/SignatureDoesNotMatch/i.test(details)) {
    return 'Cloudflare R2 từ chối chữ ký: Access Key ID và Secret Access Key không cùng một token, token đã bị thu hồi, hoặc endpoint thuộc tài khoản khác. Hãy tạo R2 API token mới, rồi nhập lại đúng cặp Access Key ID / Secret Access Key và endpoint S3 API.';
  }
  if (/NoSuchBucket/i.test(details)) {
    return 'Không tìm thấy bucket R2. Hãy kiểm tra tên bucket ở đầu đường dẫn đích.';
  }
  if (/AccessDenied/i.test(details)) {
    return 'R2 từ chối quyền truy cập. Token cần quyền Object Read & Write cho đúng bucket.';
  }
  return details || `Rclone đã dừng với mã ${code ?? 'không xác định'}.`;
}

export function runRcloneCommand(
  rclonePath: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(rclonePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error('Rclone phản hồi quá thời gian cho phép.'));
      }
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 1_000_000) stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(explainRcloneFailure(stderr, stdout, code)));
      }
    });
  });
}

function parseVersion(output: string): string | null {
  return output.match(/^rclone\s+v?([^\s]+)/m)?.[1] ?? null;
}

function parseRemotes(output: string): RcloneRemote[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error('Rclone trả về danh sách remote không hợp lệ.');
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const remote = item as Record<string, unknown>;
    if (typeof remote.name !== 'string' || typeof remote.type !== 'string') return [];
    return [{
      name: remote.name,
      type: remote.type,
      description: typeof remote.description === 'string' ? remote.description : '',
    }];
  });
}

export async function inspectRclone(): Promise<RcloneStatus> {
  const rclonePath = await getRclonePath();
  if (!rclonePath) {
    return {
      available: false,
      version: null,
      remotes: [],
      message: 'Không tìm thấy rclone phù hợp với hệ điều hành này.',
    };
  }

  try {
    const [versionResult, remoteResult] = await Promise.all([
      runRcloneCommand(rclonePath, ['version'], 10_000),
      runRcloneCommand(rclonePath, ['listremotes', '--json', '--ask-password=false'], 10_000),
    ]);
    const remotes = parseRemotes(remoteResult.stdout);
    return {
      available: true,
      version: parseVersion(versionResult.stdout),
      remotes,
      message: remotes.length > 0
        ? `Đã tìm thấy ${remotes.length} remote trong rclone.conf.`
        : 'Rclone đã sẵn sàng nhưng chưa có remote nào trong rclone.conf.',
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      remotes: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testRcloneTarget(config: RcloneTargetConfig): Promise<RcloneTargetResult> {
  const status = await inspectRclone();
  if (!status.available) throw new Error(status.message);
  if (!status.remotes.some((remote) => remote.name === config.remoteName)) {
    throw new Error('Remote rclone đã chọn không còn tồn tại. Hãy tải lại danh sách remote.');
  }
  const rclonePath = await getRclonePath();
  if (!rclonePath) throw new Error('Không tìm thấy rclone.');
  const destinationPath = normalizeDestinationPath(config.destinationPath);
  if (!destinationPath) throw new Error('Hãy nhập ít nhất tên bucket trước khi kiểm tra kết nối.');
  const destination = buildRemoteBase(config.remoteName, destinationPath);
  await runRcloneCommand(
    rclonePath,
    [
      'lsf', destination,
      '--max-depth', '1',
      '--dirs-only',
      '--contimeout', '20s',
      '--timeout', '30s',
      '--retries', '1',
      '--low-level-retries', '1',
      '--s3-no-check-bucket',
      '--ask-password=false',
    ],
    45_000,
  );
  return { destination, message: `Kết nối thành công tới ${destination}` };
}
