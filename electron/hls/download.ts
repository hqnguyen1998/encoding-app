import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  RemoteHlsDownloadConfig,
  RemoteHlsDownloadProgress,
  RemoteHlsDownloadResult,
} from '../../shared/types';

const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCES = 100_000;
const DEFAULT_CONCURRENCY = 8;
const TOKEN_SEGMENT_PREFIX = 'bcdn_token=';

interface DownloadOptions {
  outputParentDirectory: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  onProgress?: (progress: RemoteHlsDownloadProgress) => void;
}

interface RootUrlContext {
  origin: string;
  tokenSegment: string;
  search: string;
  logicalDirectory: string;
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('URL HLS không hợp lệ.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL HLS phải bắt đầu bằng http:// hoặc https://.');
  }
  url.hash = '';
  return url;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = decodeSegment(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return sanitized || 'resource';
}

function sanitizeRelativePath(value: string): string {
  const safeParts = value
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizePathSegment);
  return safeParts.join('/') || 'resource';
}

function stripTokenSegment(pathname: string, tokenSegment: string): string {
  if (!tokenSegment) return pathname;
  const prefix = `/${tokenSegment}`;
  return pathname === prefix ? '/' : pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

function rootUrlContext(rootUrl: URL): RootUrlContext {
  const firstSegment = rootUrl.pathname.split('/').filter(Boolean)[0] ?? '';
  const tokenSegment = firstSegment.startsWith(TOKEN_SEGMENT_PREFIX) ? firstSegment : '';
  const logicalPath = stripTokenSegment(rootUrl.pathname, tokenSegment);
  return {
    origin: rootUrl.origin,
    tokenSegment,
    search: rootUrl.search,
    logicalDirectory: path.posix.dirname(logicalPath),
  };
}

export function resolveHlsReference(rawReference: string, playlistUrl: URL, context: RootUrlContext): URL {
  const resolved = new URL(rawReference, playlistUrl);
  resolved.hash = '';
  if (resolved.origin !== context.origin) return resolved;

  if (
    context.tokenSegment &&
    rawReference.trim().startsWith('/') &&
    !resolved.pathname.startsWith(`/${context.tokenSegment}/`) &&
    resolved.pathname !== `/${context.tokenSegment}`
  ) {
    resolved.pathname = `/${context.tokenSegment}${resolved.pathname}`;
  }
  if (!resolved.search && context.search) resolved.search = context.search;
  return resolved;
}

function defaultFolderName(rootUrl: URL, context: RootUrlContext): string {
  const logicalPath = stripTokenSegment(rootUrl.pathname, context.tokenSegment);
  const parent = path.posix.basename(path.posix.dirname(logicalPath));
  const playlistName = path.posix.basename(logicalPath, path.posix.extname(logicalPath));
  return `${sanitizePathSegment(parent && parent !== '/' ? parent : playlistName || 'remote')}-hls`;
}

function validateFolderName(value: string | undefined, rootUrl: URL, context: RootUrlContext): string {
  if (!value?.trim()) return defaultFolderName(rootUrl, context);
  const sanitized = sanitizePathSegment(value.trim());
  if (sanitized !== value.trim() || sanitized.length > 80) {
    throw new Error('Tên thư mục chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.');
  }
  return sanitized;
}

function looksLikePlaylist(url: URL, contentType: string, bytes: Uint8Array): boolean {
  if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(url.pathname)) return true;
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 32))).trimStart();
  return prefix.startsWith('#EXTM3U');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function displayHttpError(response: Response): Error {
  const suffix = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`Nguồn HLS trả về HTTP ${response.status}${suffix}. Hãy kiểm tra token, thời hạn hoặc giới hạn IP của URL.`);
}

function abortError(): Error {
  const error = new Error('Đã hủy tải HLS từ URL.');
  error.name = 'AbortError';
  return error;
}

function isInlineReference(value: string): boolean {
  return /^(data|urn|skd):/i.test(value.trim());
}

interface PlaylistReference {
  raw: string;
  start: number;
  end: number;
}

export function findPlaylistReferences(playlist: string): PlaylistReference[] {
  const references: PlaylistReference[] = [];
  let offset = 0;
  for (const line of playlist.split(/(?<=\n)/)) {
    const content = line.replace(/[\r\n]+$/, '');
    const leading = content.length - content.trimStart().length;
    const trimmed = content.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const start = offset + leading;
      references.push({ raw: trimmed, start, end: start + trimmed.length });
    } else if (trimmed.startsWith('#')) {
      const uriPattern = /URI\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi;
      let match: RegExpExecArray | null;
      while ((match = uriPattern.exec(content)) !== null) {
        const raw = match[1] ?? match[2] ?? '';
        const rawOffset = match[1] !== undefined
          ? match.index + match[0].indexOf('"') + 1
          : match.index + match[0].lastIndexOf(raw);
        references.push({ raw, start: offset + rawOffset, end: offset + rawOffset + raw.length });
      }
    }
    offset += line.length;
  }
  return references;
}

export async function downloadRemoteHls(
  config: RemoteHlsDownloadConfig,
  options: DownloadOptions,
): Promise<RemoteHlsDownloadResult> {
  if (!config || typeof config.url !== 'string' || !config.url.trim() || config.url.length > 8_000) {
    throw new Error('URL HLS không hợp lệ.');
  }
  const rootUrl = parseHttpUrl(config.url);
  const context = rootUrlContext(rootUrl);
  const outputFolderName = validateFolderName(config.folderName, rootUrl, context);
  const outputPath = path.join(options.outputParentDirectory, outputFolderName);
  await mkdir(outputPath, { recursive: false });

  const fetchImpl = options.fetchImpl ?? fetch;
  const semaphore = new Semaphore(Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 32)));
  const downloads = new Map<string, Promise<string>>();
  const pathsToUrls = new Map<string, string>();
  let completedFiles = 0;
  let totalBytes = 0;

  const emitProgress = (statusText: string) => options.onProgress?.({
    completedFiles,
    discoveredFiles: downloads.size,
    bytes: totalBytes,
    statusText,
  });

  const chooseLocalPath = (url: URL, isRoot: boolean): string => {
    if (isRoot) return 'master.m3u8';
    const logicalPath = stripTokenSegment(url.pathname, context.tokenSegment);
    let relative: string;
    if (url.origin === context.origin) {
      relative = path.posix.relative(context.logicalDirectory, logicalPath);
      if (!relative || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
        relative = `_external/${sanitizePathSegment(url.hostname)}/${logicalPath.replace(/^\/+/, '')}`;
      }
    } else {
      relative = `_external/${sanitizePathSegment(url.hostname)}/${logicalPath.replace(/^\/+/, '')}`;
    }
    let safePath = sanitizeRelativePath(relative);
    const owner = pathsToUrls.get(safePath.toLowerCase());
    if (owner && owner !== url.href) {
      const extension = path.posix.extname(safePath);
      const base = extension ? safePath.slice(0, -extension.length) : safePath;
      safePath = `${base}-${shortHash(url.href)}${extension}`;
    }
    pathsToUrls.set(safePath.toLowerCase(), url.href);
    return safePath;
  };

  const downloadResource = (url: URL, localPath: string): Promise<string> => {
    const key = url.href;
    const existing = downloads.get(key);
    if (existing) return existing;
    if (downloads.size >= MAX_RESOURCES) {
      throw new Error(`HLS có quá nhiều tài nguyên (giới hạn ${MAX_RESOURCES.toLocaleString('en-US')} file).`);
    }

    const task = (async () => {
      if (options.signal?.aborted) throw abortError();
      emitProgress(`Đang tải ${downloads.size} tài nguyên HLS…`);
      const { response, bytes } = await semaphore.run(async () => {
        const fetchResponse = await fetchImpl(url, {
          signal: options.signal,
          redirect: 'follow',
          headers: {
            Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*',
            'User-Agent': 'Dao-Phim-Encoding/1.0',
          },
        });
        if (!fetchResponse.ok) throw displayHttpError(fetchResponse);
        return {
          response: fetchResponse,
          bytes: new Uint8Array(await fetchResponse.arrayBuffer()),
        };
      });
      if (options.signal?.aborted) throw abortError();

      let outputBytes: Uint8Array = bytes;
      if (looksLikePlaylist(url, response.headers.get('content-type') ?? '', bytes)) {
        if (bytes.byteLength > MAX_PLAYLIST_BYTES) throw new Error('Playlist HLS vượt quá giới hạn 5 MB.');
        const playlist = new TextDecoder().decode(bytes);
        if (!playlist.trimStart().startsWith('#EXTM3U')) throw new Error('Nội dung URL không phải playlist HLS hợp lệ.');
        const references = findPlaylistReferences(playlist).filter((reference) => reference.raw && !isInlineReference(reference.raw));
        const replacements = references.map((reference) => {
          const childUrl = resolveHlsReference(reference.raw, url, context);
          const childPath = chooseLocalPath(childUrl, false);
          const childTask = downloadResource(childUrl, childPath);
          void childTask.catch(() => undefined);
          return {
            ...reference,
            childPath,
          };
        });
        let rewritten = playlist;
        for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
          let relativePath = path.posix.relative(path.posix.dirname(localPath), replacement.childPath);
          if (!relativePath.startsWith('.')) relativePath = relativePath || path.posix.basename(replacement.childPath);
          rewritten = `${rewritten.slice(0, replacement.start)}${relativePath}${rewritten.slice(replacement.end)}`;
        }
        outputBytes = new TextEncoder().encode(rewritten);
      }

      const absolutePath = path.join(outputPath, ...localPath.split('/'));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, outputBytes);
      completedFiles += 1;
      totalBytes += outputBytes.byteLength;
      emitProgress(`Đã tải ${completedFiles}/${downloads.size} file HLS`);
      return localPath;
    })();
    downloads.set(key, task);
    return task;
  };

  pathsToUrls.set('master.m3u8', rootUrl.href);
  await downloadResource(rootUrl, 'master.m3u8');
  while (true) {
    const currentDownloads = [...downloads.values()];
    await Promise.all(currentDownloads);
    if (currentDownloads.length === downloads.size) break;
  }
  return {
    outputPath,
    rootPlaylistPath: path.join(outputPath, 'master.m3u8'),
    fileCount: completedFiles,
    totalBytes,
  };
}

export function createRemoteHlsDownloadJobId(): string {
  return `hls-url-${randomUUID()}`;
}
