import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EncodeConfig, EncodeEvent, EncodeProgress, MediaInfo, VideoEncoderId } from '../../shared/types';
import { normalizeAdvancedEncodeSettings } from '../../shared/encode-settings';
import { buildEncodeCommand } from './command';
import { validateHlsOutput } from './validate';

type EmitEvent = (event: EncodeEvent) => void;

function parseNumeric(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(/x$/, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

export function resolveOutputFps(config: EncodeConfig, media: MediaInfo): number {
  if (config.presetId === 'copy-source') return media.fps;
  const configuredFps = normalizeAdvancedEncodeSettings(config.advanced).outputFps;
  return configuredFps === 'source' ? media.fps : configuredFps;
}

function makeProgress(values: Map<string, string>, durationSeconds: number, outputFps: number): EncodeProgress {
  const rawTime = values.get('out_time_us') ?? values.get('out_time_ms');
  const encodedSeconds = rawTime ? Number(rawTime) / 1_000_000 : 0;
  const safeEncodedSeconds = Number.isFinite(encodedSeconds) ? encodedSeconds : 0;
  const percent = Math.min(99.5, Math.max(0, (safeEncodedSeconds / durationSeconds) * 100));
  const speed = parseNumeric(values.get('speed'));
  const remainingMediaSeconds = Math.max(0, durationSeconds - safeEncodedSeconds);
  const etaSeconds = speed && speed > 0 ? remainingMediaSeconds / speed : null;

  return {
    percent,
    encodedSeconds: safeEncodedSeconds,
    durationSeconds,
    // FFmpeg's progress `fps` is processing throughput, not the frame rate of
    // the encoded HLS. The UI already presents throughput as `speed` (e.g. 9.5x),
    // so expose the actual configured/source frame rate here instead.
    fps: outputFps,
    speed,
    etaSeconds,
    statusText:
      percent < 1
        ? 'Đang khởi tạo bộ mã hóa'
        : percent > 97
          ? 'Đang hoàn tất playlist'
          : 'Đang tạo các phân đoạn HLS',
  };
}

export class EncodeJob {
  readonly id = randomUUID();
  readonly outputPath: string;
  private process: ChildProcess | null = null;
  private cancelled = false;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ffmpegPath: string,
    private readonly config: EncodeConfig,
    private readonly media: MediaInfo,
    outputPath: string,
    private readonly emit: EmitEvent,
    private readonly videoEncoderId: Exclude<VideoEncoderId, 'auto'>,
    private readonly videoEncoderLabel: string,
  ) {
    this.outputPath = outputPath;
  }

  async start(): Promise<void> {
    const { args, renditions } = buildEncodeCommand(this.config, this.media, this.outputPath);
    const outputFps = resolveOutputFps(this.config, this.media);
    await mkdir(this.outputPath, { recursive: true });
    await Promise.all(
      renditions.map((_, index) => mkdir(path.join(this.outputPath, `v${index}`), { recursive: true })),
    );

    const child = spawn(this.ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;
    this.emit({
      type: 'started',
      jobId: this.id,
      outputPath: this.outputPath,
      videoEncoderId: this.videoEncoderId,
      videoEncoderLabel: this.videoEncoderLabel,
    });

    const progressValues = new Map<string, string>();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const recentErrors: string[] = [];

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator < 0) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        progressValues.set(key, value);
        if (key === 'progress') {
          this.emit({
            type: 'progress',
            jobId: this.id,
            progress: makeProgress(progressValues, this.media.durationSeconds, outputFps),
          });
        }
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        recentErrors.push(line);
        if (recentErrors.length > 8) recentErrors.shift();
        this.emit({ type: 'log', jobId: this.id, line });
      }
    });

    child.on('error', (error) => {
      this.clearKillTimer();
      this.emit({ type: 'failed', jobId: this.id, message: error.message });
    });

    child.on('close', (code) => {
      this.clearKillTimer();
      this.process = null;
      if (this.cancelled) {
        this.emit({ type: 'cancelled', jobId: this.id });
      } else if (code === 0) {
        this.emit({
          type: 'log',
          jobId: this.id,
          line: 'Đang kiểm tra khả năng giải mã HLS trước khi hoàn tất…',
        });
        void validateHlsOutput(this.ffmpegPath, this.outputPath)
          .then(() => {
            this.emit({
              type: 'log',
              jobId: this.id,
              line: 'Kiểm tra HLS thành công.',
            });
            this.emit({ type: 'completed', jobId: this.id, outputPath: this.outputPath });
          })
          .catch((error: unknown) => {
            this.emit({
              type: 'failed',
              jobId: this.id,
              message: error instanceof Error ? error.message : 'Không thể kiểm tra HLS đầu ra.',
            });
          });
      } else {
        this.emit({
          type: 'failed',
          jobId: this.id,
          message: recentErrors.slice(-4).join('\n') || `FFmpeg đã dừng với mã ${code ?? 'không xác định'}.`,
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
      this.killTimer = setTimeout(() => {
        this.process?.kill('SIGKILL');
      }, 3_000);
    }
    return true;
  }

  private clearKillTimer(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
  }
}
