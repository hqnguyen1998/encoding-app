import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  RcloneRemoteConfig,
  RcloneRemoteConfigResult,
} from '../../shared/types';
import { getRclonePath } from './binary';
import { runRcloneCommand } from './client';

const REMOTE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/;

function assertSingleLine(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) throw new Error(`${label} không hợp lệ.`);
  return trimmed;
}

export function validateRcloneRemoteConfig(config: RcloneRemoteConfig): RcloneRemoteConfig {
  if (!config || typeof config !== 'object') throw new Error('Cấu hình remote không hợp lệ.');
  const name = assertSingleLine(config.name, 'Tên remote');
  if (!REMOTE_NAME_PATTERN.test(name)) {
    throw new Error('Tên remote chỉ được dùng chữ, số, dấu chấm, gạch dưới, gạch ngang và khoảng trắng.');
  }
  if (!['Cloudflare', 'AWS', 'Other'].includes(config.provider)) {
    throw new Error('Nhà cung cấp S3 không hợp lệ.');
  }
  const accessKeyId = assertSingleLine(config.accessKeyId, 'Access Key ID');
  const secretAccessKey = assertSingleLine(config.secretAccessKey, 'Secret Access Key');
  const endpoint = config.endpoint.trim();
  const region = (config.region.trim() || (config.provider === 'AWS' ? 'us-east-1' : 'auto'));
  if (/[\r\n\0]/.test(endpoint) || /[\r\n\0]/.test(region)) {
    throw new Error('Endpoint hoặc region không hợp lệ.');
  }
  if (config.provider !== 'AWS' && !endpoint) {
    throw new Error('Hãy nhập endpoint cho Cloudflare R2 hoặc S3 tương thích.');
  }
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Endpoint phải là URL đầy đủ, ví dụ https://account-id.r2.cloudflarestorage.com');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Endpoint phải bắt đầu bằng https:// hoặc http://');
    }
  }
  return { name, provider: config.provider, accessKeyId, secretAccessKey, endpoint, region };
}

export function upsertRcloneConfig(
  existing: string,
  config: RcloneRemoteConfig,
  obscuredSecret: string,
): string {
  const safe = validateRcloneRemoteConfig(config);
  const secret = assertSingleLine(obscuredSecret, 'Secret đã mã hóa');
  const lines = existing.replace(/\r\n/g, '\n').split('\n');
  const sectionStart = lines.findIndex((line) => line.trim() === `[${safe.name}]`);
  if (sectionStart >= 0) {
    let sectionEnd = sectionStart + 1;
    while (sectionEnd < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[sectionEnd])) sectionEnd += 1;
    lines.splice(sectionStart, sectionEnd - sectionStart);
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const section = [
    `[${safe.name}]`,
    'type = s3',
    `provider = ${safe.provider}`,
    'env_auth = false',
    `access_key_id = ${safe.accessKeyId}`,
    `secret_access_key = ${secret}`,
    `region = ${safe.region}`,
    ...(safe.endpoint ? [`endpoint = ${safe.endpoint}`] : []),
  ];
  return `${[...lines, ...(lines.length ? [''] : []), ...section].join('\n')}\n`;
}

export function parseRcloneConfigPath(output: string): string {
  const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const filePath = candidates.at(-1)?.replace(/^['"]|['"]$/g, '') ?? '';
  if (!filePath || filePath.includes('\0')) throw new Error('Không xác định được vị trí rclone.conf.');
  return filePath;
}

function obscureSecret(rclonePath: string, secret: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(rclonePath, ['obscure', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error('Rclone không thể bảo vệ Secret Access Key trong thời gian cho phép.'));
      }
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error('Không thể chạy rclone để bảo vệ Secret Access Key.'));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const value = stdout.trim();
      if (code === 0 && value && !/[\r\n]/.test(value)) resolve(value);
      else reject(new Error(stderr.trim() ? 'Rclone từ chối làm mờ Secret Access Key.' : 'Không thể bảo vệ Secret Access Key bằng rclone.'));
    });
    child.stdin.end(`${secret}\n`);
  });
}

export async function saveRcloneRemote(config: RcloneRemoteConfig): Promise<RcloneRemoteConfigResult> {
  const safe = validateRcloneRemoteConfig(config);
  const rclonePath = await getRclonePath();
  if (!rclonePath) throw new Error('Không tìm thấy rclone phù hợp với hệ điều hành này.');

  const configFileResult = await runRcloneCommand(rclonePath, ['config', 'file'], 10_000);
  const configPath = parseRcloneConfigPath(configFileResult.stdout);
  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (/^RCLONE_ENCRYPT_V\d+:/m.test(existing)) {
    throw new Error('rclone.conf đang được mã hóa. Ứng dụng có thể dùng remote hiện có nhưng không thể chỉnh sửa file này.');
  }

  const obscuredSecret = await obscureSecret(rclonePath, safe.secretAccessKey);
  const nextConfig = upsertRcloneConfig(existing, safe, obscuredSecret);
  const configDirectory = path.dirname(configPath);
  const tempPath = path.join(configDirectory, `.rclone.conf.${process.pid}.${Date.now()}.tmp`);
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(tempPath, nextConfig, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, configPath);
    await chmod(configPath, 0o600).catch(() => undefined);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return {
    remote: { name: safe.name, type: 's3', description: `${safe.provider} S3` },
    message: `Đã lưu remote ${safe.name} vào rclone.conf.`,
  };
}
