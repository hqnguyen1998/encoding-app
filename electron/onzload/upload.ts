import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  OnzloadUploadConfig,
  OnzloadUploadEvent,
  OnzloadUploadResult,
  RcloneUploadProgress,
} from '../../shared/types';
import { resolveRcloneUploadPerformance } from '../../shared/upload-performance';
import { parseRcloneStatsLine } from '../rclone/upload';
import { onzloadApiRequest, readOnzloadSession } from './auth';

type EmitEvent = (event: OnzloadUploadEvent) => void;

interface PreparedUpload {
  uploadId: string;
  assetId: string;
  jobId: string;
  outputPrefix: string;
  playlistKey: string;
  completed: boolean;
  embedPath: string;
  endpoint?: string;
  bucket?: string;
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiresAt: string;
  };
}

interface CompletedUpload {
  uploadId: string;
  assetId: string;
  jobId: string;
  embedPath: string;
}

const ALLOWED_HLS_EXTENSIONS = new Set(['.m3u8', '.ts', '.m4s', '.mp4']);
const REMOTE_NAME = 'onzloadtmp';

function parseLogMessage(line: string): string | null {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    if (payload.stats) return null;
    return typeof payload.msg === 'string' && payload.msg.trim() ? payload.msg.trim() : null;
  } catch {
    return line.trim() || null;
  }
}

async function scanHlsFolder(root: string) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Nguồn upload phải là thư mục HLS đã encode.');
  try {
    await access(path.join(root, 'master.m3u8'));
  } catch {
    throw new Error('Thư mục HLS phải có master.m3u8 ở cấp gốc.');
  }

  let fileCount = 0;
  let totalBytes = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !ALLOWED_HLS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const info = await stat(absolutePath);
      fileCount += 1;
      totalBytes += info.size;
      if (fileCount > 50_000) throw new Error('Thư mục HLS có quá nhiều file.');
      if (!Number.isSafeInteger(totalBytes)) throw new Error('Dung lượng HLS vượt giới hạn ứng dụng.');
    }
  };
  await walk(root);
  if (!fileCount || totalBytes <= 0) throw new Error('Thư mục HLS không có dữ liệu để upload.');
  return { fileCount, totalBytes };
}

export function buildOnzloadRcloneArgs(
  config: OnzloadUploadConfig,
  destination: string,
) {
  const performance = resolveRcloneUploadPerformance(config.performanceId);
  return [
    'copy',
    config.sourcePath,
    destination,
    '--include', '*.m3u8',
    '--include', '*.ts',
    '--include', '*.m4s',
    '--include', '*.mp4',
    '--use-json-log',
    '--stats', '500ms',
    '--stats-one-line=false',
    '--stats-log-level', 'NOTICE',
    '--log-level', 'INFO',
    '--transfers', String(performance.transfers),
    '--checkers', String(performance.checkers),
    '--buffer-size', performance.bufferSize,
    '--fast-list',
    '--s3-no-check-bucket',
    '--contimeout', '30s',
    '--timeout', '5m',
    '--ask-password=false',
  ];
}

function rcloneEnvironment(prepared: PreparedUpload) {
  if (!prepared.endpoint || !prepared.credentials) throw new Error('OnzLoad không trả về credential upload.');
  return {
    ...process.env,
    RCLONE_CONFIG_ONZLOADTMP_TYPE: 's3',
    RCLONE_CONFIG_ONZLOADTMP_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_ONZLOADTMP_ENV_AUTH: 'false',
    RCLONE_CONFIG_ONZLOADTMP_ACCESS_KEY_ID: prepared.credentials.accessKeyId,
    RCLONE_CONFIG_ONZLOADTMP_SECRET_ACCESS_KEY: prepared.credentials.secretAccessKey,
    RCLONE_CONFIG_ONZLOADTMP_SESSION_TOKEN: prepared.credentials.sessionToken,
    RCLONE_CONFIG_ONZLOADTMP_ENDPOINT: prepared.endpoint,
    RCLONE_CONFIG_ONZLOADTMP_REGION: prepared.region ?? 'auto',
    RCLONE_CONFIG_ONZLOADTMP_NO_CHECK_BUCKET: 'true',
  };
}

export class OnzloadUploadJob {
  readonly id = randomUUID();
  private process: ChildProcess | null = null;
  private cancelled = false;
  private settled = false;
  private uploadId: string | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private lastProgress: RcloneUploadProgress | null = null;
  private lastReportedAt = 0;

  constructor(
    private readonly rclonePath: string,
    private readonly config: OnzloadUploadConfig,
    private readonly emit: EmitEvent,
  ) {}

  async start(): Promise<void> {
    const folder = await scanHlsFolder(this.config.sourcePath);
    const session = await readOnzloadSession();
    if (!session) throw new Error('Vui lòng liên kết tài khoản OnzLoad trước.');
    const prepared = await onzloadApiRequest<PreparedUpload>('/api/desktop/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalName: this.config.originalName || path.basename(this.config.sourcePath).replace(/-hls(?:-\d+)?$/i, ''),
        idempotencyKey: this.config.idempotencyKey,
        segmentDuration: this.config.segmentDuration,
        albumId: this.config.albumId,
        playlistPath: 'master.m3u8',
        fileCount: folder.fileCount,
        totalBytes: folder.totalBytes,
      }),
    });
    this.uploadId = prepared.uploadId;
    if (prepared.completed) {
      this.settled = true;
      this.emit({
        type: 'completed',
        jobId: this.id,
        result: {
          uploadId: prepared.uploadId,
          assetId: prepared.assetId,
          encodeJobId: prepared.jobId,
          embedUrl: `${session.baseUrl}${prepared.embedPath}`,
        },
      });
      return;
    }
    if (!prepared.bucket || !prepared.credentials) throw new Error('OnzLoad không trả về đích upload hợp lệ.');
    const destination = `${REMOTE_NAME}:${prepared.bucket}/${prepared.outputPrefix}`;
    const performance = resolveRcloneUploadPerformance(this.config.performanceId);
    const child = spawn(this.rclonePath, buildOnzloadRcloneArgs(this.config, destination), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: rcloneEnvironment(prepared),
    });
    this.process = child;
    this.emit({ type: 'started', jobId: this.id, uploadId: prepared.uploadId, destination });
    this.emit({
      type: 'log',
      jobId: this.id,
      line: `OnzLoad đã cấp quyền upload tạm thời. Tốc độ ${performance.name}: ${performance.transfers} file song song.`,
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const recentErrors: string[] = [];
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    const consume = (chunk: string, fromStderr: boolean) => {
      if (fromStderr) stderrBuffer += chunk;
      else stdoutBuffer += chunk;
      const current = fromStderr ? stderrBuffer : stdoutBuffer;
      const lines = current.split(/\r?\n/);
      if (fromStderr) stderrBuffer = lines.pop() ?? '';
      else stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const progress = parseRcloneStatsLine(line);
        if (progress) {
          this.lastProgress = progress;
          this.emit({ type: 'progress', jobId: this.id, progress });
          this.reportProgress(progress.percent);
          continue;
        }
        const message = parseLogMessage(line);
        if (!message) continue;
        recentErrors.push(message);
        if (recentErrors.length > 10) recentErrors.shift();
        this.emit({ type: 'log', jobId: this.id, line: message });
      }
    };

    child.stdout?.on('data', (chunk: Buffer | string) => consume(String(chunk), false));
    child.stderr?.on('data', (chunk: Buffer | string) => consume(String(chunk), true));
    child.on('error', (error) => this.finishFailed(error.message));
    child.on('close', (code) => {
      void this.handleClose(code, prepared, session.baseUrl, recentErrors);
    });
  }

  cancel(): boolean {
    if (this.settled) return false;
    this.cancelled = true;
    if (this.uploadId) {
      void onzloadApiRequest(`/api/desktop/v1/uploads/${encodeURIComponent(this.uploadId)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    if (!this.process || this.process.killed) return false;
    if (process.platform === 'win32' && this.process.pid) {
      spawn('taskkill', ['/pid', String(this.process.pid), '/t', '/f'], { windowsHide: true });
    } else {
      this.process.kill('SIGTERM');
      this.killTimer = setTimeout(() => this.process?.kill('SIGKILL'), 3_000);
    }
    return true;
  }

  private reportProgress(percent: number) {
    if (!this.uploadId || Date.now() - this.lastReportedAt < 1_000) return;
    this.lastReportedAt = Date.now();
    void onzloadApiRequest(`/api/desktop/v1/uploads/${encodeURIComponent(this.uploadId)}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: percent }),
    }).catch(() => undefined);
  }

  private async handleClose(
    code: number | null,
    prepared: PreparedUpload,
    baseUrl: string,
    recentErrors: string[],
  ) {
    this.clearKillTimer();
    this.process = null;
    if (this.settled) return;
    if (this.cancelled) {
      this.settled = true;
      this.emit({ type: 'cancelled', jobId: this.id });
      return;
    }
    if (code !== 0) {
      this.finishFailed(recentErrors.slice(-4).join('\n') || `Rclone đã dừng với mã ${code ?? 'không xác định'}.`);
      return;
    }

    try {
      this.emit({ type: 'log', jobId: this.id, line: 'Upload xong. OnzLoad đang xác minh playlist và tạo dữ liệu video...' });
      const completed = await onzloadApiRequest<CompletedUpload>(
        `/api/desktop/v1/uploads/${encodeURIComponent(prepared.uploadId)}/complete`,
        { method: 'POST' },
      );
      const progress = this.lastProgress;
      this.emit({
        type: 'progress',
        jobId: this.id,
        progress: {
          percent: 100,
          bytes: progress?.totalBytes ?? progress?.bytes ?? 0,
          totalBytes: progress?.totalBytes ?? progress?.bytes ?? 0,
          speedBytesPerSecond: progress?.speedBytesPerSecond ?? 0,
          etaSeconds: 0,
          files: progress?.totalFiles ?? progress?.files ?? 0,
          totalFiles: progress?.totalFiles ?? progress?.files ?? 0,
        },
      });
      const result: OnzloadUploadResult = {
        uploadId: completed.uploadId,
        assetId: completed.assetId,
        encodeJobId: completed.jobId,
        embedUrl: `${baseUrl}${completed.embedPath}`,
      };
      this.settled = true;
      this.emit({ type: 'completed', jobId: this.id, result });
    } catch (error) {
      this.finishFailed(error instanceof Error ? error.message : String(error));
    }
  }

  private finishFailed(message: string) {
    this.clearKillTimer();
    if (this.settled) return;
    this.settled = true;
    this.emit({ type: 'failed', jobId: this.id, message });
  }

  private clearKillTimer() {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
  }
}
