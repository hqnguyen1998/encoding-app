import { spawn, type ChildProcess } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  RcloneUploadConfig,
  RcloneUploadEvent,
  RcloneUploadProgress,
} from '../../shared/types';
import { resolveRcloneUploadPerformance } from '../../shared/upload-performance';

type EmitEvent = (event: RcloneUploadEvent) => void;

interface RcloneStats {
  bytes?: unknown;
  totalBytes?: unknown;
  speed?: unknown;
  eta?: unknown;
  transfers?: unknown;
  totalTransfers?: unknown;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeDestinationPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (/[:\0\r\n]/.test(normalized)) throw new Error('Đường dẫn đích không được chứa dấu hai chấm hoặc ký tự xuống dòng.');
  if (normalized.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Đường dẫn đích không được chứa . hoặc ..');
  }
  return normalized;
}

export function buildRemoteBase(remoteName: string, destinationPath: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/.test(remoteName)) {
    throw new Error('Tên remote rclone không hợp lệ.');
  }
  const normalized = normalizeDestinationPath(destinationPath);
  return normalized ? `${remoteName}:${normalized}` : `${remoteName}:`;
}

export function buildRemoteDestination(config: RcloneUploadConfig): string {
  const base = normalizeDestinationPath(config.destinationPath);
  const folder = normalizeDestinationPath(path.basename(config.sourcePath));
  return buildRemoteBase(config.remoteName, [base, folder].filter(Boolean).join('/'));
}

export function buildRcloneUploadArgs(config: RcloneUploadConfig): string[] {
  const performance = resolveRcloneUploadPerformance(config.performanceId);
  return [
    'copy',
    config.sourcePath,
    buildRemoteDestination(config),
    '--use-json-log',
    '--stats', '500ms',
    '--stats-one-line=false',
    '--stats-log-level', 'NOTICE',
    '--log-level', 'INFO',
    '--transfers', String(performance.transfers),
    '--checkers', String(performance.checkers),
    '--buffer-size', performance.bufferSize,
    '--fast-list',
    '--contimeout', '30s',
    '--timeout', '5m',
    '--ask-password=false',
  ];
}

export function parseRcloneStatsLine(line: string): RcloneUploadProgress | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!payload.stats || typeof payload.stats !== 'object') return null;
  const stats = payload.stats as RcloneStats;
  const bytes = finiteNumber(stats.bytes);
  const totalBytes = finiteNumber(stats.totalBytes);
  const files = finiteNumber(stats.transfers);
  const totalFiles = finiteNumber(stats.totalTransfers);
  const ratio = totalBytes > 0 ? bytes / totalBytes : totalFiles > 0 ? files / totalFiles : 0;
  return {
    percent: Math.min(99.5, Math.max(0, ratio * 100)),
    bytes,
    totalBytes,
    speedBytesPerSecond: finiteNumber(stats.speed),
    etaSeconds: typeof stats.eta === 'number' && Number.isFinite(stats.eta) ? stats.eta : null,
    files,
    totalFiles,
  };
}

function parseLogMessage(line: string): string | null {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    if (payload.stats) return null;
    return typeof payload.msg === 'string' && payload.msg.trim() ? payload.msg.trim() : null;
  } catch {
    return line.trim() || null;
  }
}

export class RcloneUploadJob {
  readonly id = randomUUID();
  readonly destination: string;
  private process: ChildProcess | null = null;
  private cancelled = false;
  private settled = false;
  private killTimer: NodeJS.Timeout | null = null;
  private lastProgress: RcloneUploadProgress | null = null;

  constructor(
    private readonly rclonePath: string,
    private readonly config: RcloneUploadConfig,
    private readonly emit: EmitEvent,
  ) {
    this.destination = buildRemoteDestination(config);
  }

  async start(): Promise<void> {
    const source = await stat(this.config.sourcePath);
    if (!source.isDirectory()) throw new Error('Nguồn upload phải là thư mục HLS đã encode.');
    try {
      await access(path.join(this.config.sourcePath, 'master.m3u8'));
    } catch {
      throw new Error('Thư mục đã chọn không có master.m3u8 ở cấp gốc.');
    }

    const performance = resolveRcloneUploadPerformance(this.config.performanceId);
    const child = spawn(this.rclonePath, buildRcloneUploadArgs(this.config), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;
    this.emit({ type: 'started', jobId: this.id, destination: this.destination });
    this.emit({
      type: 'log',
      jobId: this.id,
      line: `Tốc độ ${performance.name}: ${performance.transfers} file song song, ${performance.checkers} checkers.`,
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const recentErrors: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

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
          continue;
        }
        const message = parseLogMessage(line);
        if (!message) continue;
        recentErrors.push(message);
        if (recentErrors.length > 10) recentErrors.shift();
        this.emit({ type: 'log', jobId: this.id, line: message });
      }
    };

    child.stdout.on('data', (chunk: string) => consume(chunk, false));
    child.stderr.on('data', (chunk: string) => consume(chunk, true));
    child.on('error', (error) => this.finishFailed(error.message));
    child.on('close', (code) => {
      this.clearKillTimer();
      this.process = null;
      if (this.settled) return;
      this.settled = true;
      if (this.cancelled) {
        this.emit({ type: 'cancelled', jobId: this.id });
      } else if (code === 0) {
        this.emit({ type: 'progress', jobId: this.id, progress: {
          ...this.lastProgress,
          percent: 100,
          bytes: this.lastProgress?.bytes ?? 0,
          totalBytes: this.lastProgress?.totalBytes ?? 0,
          speedBytesPerSecond: this.lastProgress?.speedBytesPerSecond ?? 0,
          etaSeconds: 0,
          files: this.lastProgress?.files ?? 0,
          totalFiles: this.lastProgress?.totalFiles ?? 0,
        } });
        this.emit({ type: 'completed', jobId: this.id, destination: this.destination });
      } else {
        this.emit({
          type: 'failed',
          jobId: this.id,
          message: recentErrors.slice(-4).join('\n') || `Rclone đã dừng với mã ${code ?? 'không xác định'}.`,
        });
      }
    });
  }

  cancel(): boolean {
    if (!this.process || this.process.killed) return false;
    this.cancelled = true;
    if (process.platform === 'win32' && this.process.pid) {
      spawn('taskkill', ['/pid', String(this.process.pid), '/t', '/f'], { windowsHide: true });
    } else {
      this.process.kill('SIGTERM');
      this.killTimer = setTimeout(() => this.process?.kill('SIGKILL'), 3_000);
    }
    return true;
  }

  private finishFailed(message: string): void {
    this.clearKillTimer();
    if (this.settled) return;
    this.settled = true;
    this.emit({ type: 'failed', jobId: this.id, message });
  }

  private clearKillTimer(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
  }
}
