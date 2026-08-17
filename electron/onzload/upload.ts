import { randomUUID } from 'node:crypto';
import { access, opendir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import type {
  OnzloadUploadConfig,
  OnzloadUploadEvent,
  OnzloadUploadResult,
  UploadProgress,
} from '../../shared/types';
import { resolveUploadPerformance } from '../../shared/upload-performance';
import { onzloadApiRequest, readOnzloadSession } from './auth';

type EmitEvent = (event: OnzloadUploadEvent) => void;

interface HlsUploadFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

interface PreparedUpload {
  uploadId: string;
  assetId: string;
  jobId: string;
  completed: boolean;
  embedPath: string;
}

interface PresignedUploadFile {
  relativePath: string;
  size: number;
  uploadUrl: string;
  headers: Record<string, string>;
}

interface PresignedUploadBatch {
  uploadId: string;
  expiresIn: number;
  files: PresignedUploadFile[];
}

interface CompletedUpload {
  uploadId: string;
  assetId: string;
  jobId: string;
  embedPath: string;
}

const ALLOWED_HLS_EXTENSIONS = new Set(['.m3u8', '.ts', '.m4s', '.mp4']);
const PRESIGN_BATCH_SIZE = 100;
const UPLOAD_ATTEMPTS = 3;

class DirectUploadError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'DirectUploadError';
  }
}

function hlsRelativePath(root: string, absolutePath: string) {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  if (
    !relativePath ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Thư mục HLS chứa đường dẫn file không an toàn.');
  }
  return relativePath;
}

export async function scanHlsFolder(root: string) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Nguồn upload phải là thư mục HLS đã encode.');
  try {
    await access(path.join(root, 'master.m3u8'));
  } catch {
    throw new Error('Thư mục HLS phải có master.m3u8 ở cấp gốc.');
  }

  const files: HlsUploadFile[] = [];
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
      if (info.size <= 0) throw new Error(`File HLS rỗng: ${entry.name}`);
      files.push({ absolutePath, relativePath: hlsRelativePath(root, absolutePath), size: info.size });
      totalBytes += info.size;
      if (files.length > 50_000) throw new Error('Thư mục HLS có quá nhiều file.');
      if (!Number.isSafeInteger(totalBytes)) throw new Error('Dung lượng HLS vượt giới hạn ứng dụng.');
    }
  };
  await walk(root);
  if (!files.length || totalBytes <= 0) throw new Error('Thư mục HLS không có dữ liệu để upload.');
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files, fileCount: files.length, totalBytes };
}

export function presignRequestFiles(files: HlsUploadFile[]) {
  return files.map(({ relativePath, size }) => ({ relativePath, size }));
}

export async function uploadSignedFile(
  file: HlsUploadFile,
  signed: PresignedUploadFile,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
  fetchImpl: typeof fetch = fetch,
) {
  if (signed.relativePath !== file.relativePath || signed.size !== file.size) {
    throw new Error(`OnzLoad trả về URL không khớp file ${file.relativePath}.`);
  }
  let sentBytes = 0;
  const source = createReadStream(file.absolutePath);
  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sentBytes += chunk.length;
      onBytes(Math.min(file.size, sentBytes));
      callback(null, chunk);
    },
  });
  const body = source.pipe(progressStream);
  const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000);
  let response: Response;
  try {
    response = await fetchImpl(signed.uploadUrl, {
      method: 'PUT',
      headers: {
        ...signed.headers,
        'Content-Length': String(file.size),
      },
      body: body as unknown as BodyInit,
      duplex: 'half',
      signal: AbortSignal.any([signal, timeoutSignal]),
    } as RequestInit & { duplex: 'half' });
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: unknown }).cause
      : null;
    const detail = cause instanceof Error
      ? cause.message
      : error instanceof Error
        ? error.message
        : String(error);
    throw new DirectUploadError(`Không thể upload ${file.relativePath}: ${detail}`);
  } finally {
    source.destroy();
    progressStream.destroy();
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new DirectUploadError(
      `R2 từ chối ${file.relativePath} (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
      response.status,
    );
  }
  await response.arrayBuffer();
  onBytes(file.size);
}

async function waitBeforeRetry(attempt: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(finish, 500 * (2 ** (attempt - 1)));
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason ?? new Error('Upload đã bị hủy.'));
    };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

export class OnzloadUploadJob {
  readonly id = randomUUID();
  private readonly controller = new AbortController();
  private cancelled = false;
  private settled = false;
  private uploadId: string | null = null;
  private completedBytes = 0;
  private completedFiles = 0;
  private totalBytes = 0;
  private totalFiles = 0;
  private startedAt = 0;
  private lastProgressEmitAt = 0;
  private lastReportedAt = 0;
  private readonly activeBytes = new Map<string, number>();

  constructor(
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

    this.totalBytes = folder.totalBytes;
    this.totalFiles = folder.fileCount;
    this.startedAt = Date.now();
    const performance = resolveUploadPerformance(this.config.performanceId);
    this.emit({ type: 'started', jobId: this.id, uploadId: prepared.uploadId, destination: 'OnzLoad Storage' });
    this.emit({
      type: 'log',
      jobId: this.id,
      line: `OnzLoad đã cấp URL upload bảo mật. Tốc độ ${performance.name}: ${performance.transfers} file song song.`,
    });
    void this.run(prepared, folder.files, session.baseUrl, performance.transfers);
  }

  cancel(): boolean {
    if (this.settled || this.cancelled) return false;
    this.cancelled = true;
    this.controller.abort(new Error('Upload đã bị hủy.'));
    if (this.uploadId) {
      void onzloadApiRequest(`/api/desktop/v1/uploads/${encodeURIComponent(this.uploadId)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    return true;
  }

  private async run(prepared: PreparedUpload, files: HlsUploadFile[], baseUrl: string, concurrency: number) {
    try {
      for (let offset = 0; offset < files.length; offset += PRESIGN_BATCH_SIZE) {
        if (this.controller.signal.aborted) throw this.controller.signal.reason;
        const batch = files.slice(offset, offset + PRESIGN_BATCH_SIZE);
        const signed = await onzloadApiRequest<PresignedUploadBatch>(
          `/api/desktop/v1/uploads/${encodeURIComponent(prepared.uploadId)}/files`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: presignRequestFiles(batch) }),
            signal: this.controller.signal,
          },
        );
        const signedByPath = new Map(signed.files.map((file) => [file.relativePath, file]));
        if (signedByPath.size !== batch.length) throw new Error('OnzLoad trả về thiếu URL upload.');
        await runWithConcurrency(batch, concurrency, async (file) => {
          const signedFile = signedByPath.get(file.relativePath);
          if (!signedFile) throw new Error(`OnzLoad chưa cấp URL cho ${file.relativePath}.`);
          await this.uploadWithRetry(file, signedFile);
        });
      }

      this.emit({ type: 'log', jobId: this.id, line: 'Upload xong. OnzLoad đang xác minh playlist và tạo dữ liệu video...' });
      const completed = await onzloadApiRequest<CompletedUpload>(
        `/api/desktop/v1/uploads/${encodeURIComponent(prepared.uploadId)}/complete`,
        { method: 'POST', signal: this.controller.signal },
      );
      this.emitProgress(true);
      const result: OnzloadUploadResult = {
        uploadId: completed.uploadId,
        assetId: completed.assetId,
        encodeJobId: completed.jobId,
        embedUrl: `${baseUrl}${completed.embedPath}`,
      };
      this.settled = true;
      this.emit({ type: 'completed', jobId: this.id, result });
    } catch (error) {
      if (this.settled) return;
      if (this.cancelled || this.controller.signal.aborted) {
        this.settled = true;
        this.emit({ type: 'cancelled', jobId: this.id });
        return;
      }
      if (this.uploadId) {
        await onzloadApiRequest(`/api/desktop/v1/uploads/${encodeURIComponent(this.uploadId)}`, { method: 'DELETE' }).catch(() => undefined);
      }
      this.settled = true;
      this.emit({ type: 'failed', jobId: this.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async uploadWithRetry(file: HlsUploadFile, signed: PresignedUploadFile) {
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
      this.activeBytes.set(file.relativePath, 0);
      try {
        await uploadSignedFile(file, signed, this.controller.signal, (bytes) => {
          this.activeBytes.set(file.relativePath, bytes);
          this.emitProgress();
        });
        this.activeBytes.delete(file.relativePath);
        this.completedBytes += file.size;
        this.completedFiles += 1;
        this.emitProgress();
        return;
      } catch (error) {
        this.activeBytes.delete(file.relativePath);
        if (this.controller.signal.aborted) throw error;
        const status = error instanceof DirectUploadError ? error.status : null;
        const retryable = status === null || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt === UPLOAD_ATTEMPTS) throw error;
        this.emit({ type: 'log', jobId: this.id, line: `Thử lại ${file.relativePath} (${attempt + 1}/${UPLOAD_ATTEMPTS})...` });
        await waitBeforeRetry(attempt, this.controller.signal);
      }
    }
  }

  private emitProgress(forceComplete = false) {
    const now = Date.now();
    if (!forceComplete && now - this.lastProgressEmitAt < 250) return;
    this.lastProgressEmitAt = now;
    const activeBytes = Array.from(this.activeBytes.values()).reduce((total, value) => total + value, 0);
    const bytes = forceComplete ? this.totalBytes : Math.min(this.totalBytes, this.completedBytes + activeBytes);
    const elapsedSeconds = Math.max(0.001, (now - this.startedAt) / 1000);
    const speedBytesPerSecond = bytes / elapsedSeconds;
    const progress: UploadProgress = {
      percent: forceComplete ? 100 : Math.min(99.5, (bytes / this.totalBytes) * 100),
      bytes,
      totalBytes: this.totalBytes,
      speedBytesPerSecond,
      etaSeconds: forceComplete || speedBytesPerSecond <= 0 ? 0 : (this.totalBytes - bytes) / speedBytesPerSecond,
      files: forceComplete ? this.totalFiles : this.completedFiles,
      totalFiles: this.totalFiles,
    };
    this.emit({ type: 'progress', jobId: this.id, progress });
    this.reportProgress(progress.percent);
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
}
