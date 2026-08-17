import path from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  CloudStorageCopyConfig,
  CloudStorageCreateFolderConfig,
  CloudStorageDeleteConfig,
  CloudStorageDownloadConfig,
  CloudStorageEntry,
  CloudStorageListResult,
  CloudStorageMoveConfig,
  CloudStorageOperationResult,
  CloudStorageRenameConfig,
  CloudStorageTargetConfig,
  CloudStorageUploadFilesConfig,
  CloudStorageUploadFolderConfig,
} from '../../shared/types';
import { getRclonePath } from './binary';
import { inspectRclone, runRcloneCommand } from './client';
import { buildRemoteBase, normalizeDestinationPath } from './upload';

const COMMON_ARGS = [
  '--contimeout', '30s',
  '--timeout', '5m',
  '--retries', '2',
  '--low-level-retries', '4',
  '--ask-password=false',
];

interface RcloneListItem {
  Path?: unknown;
  Name?: unknown;
  Size?: unknown;
  MimeType?: unknown;
  ModTime?: unknown;
  IsDir?: unknown;
}

export function normalizeCloudStoragePath(value: string): string {
  if (typeof value !== 'string' || value.length > 2_000) throw new Error('Đường dẫn cloud storage không hợp lệ.');
  return normalizeDestinationPath(value);
}

export function validateCloudStorageName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 255 || /[\\/:\0\r\n]/.test(name) || name === '.' || name === '..' || name === '.keep') {
    throw new Error('Tên chỉ được dùng tối đa 255 ký tự và không chứa /, \\, :, dấu xuống dòng.');
  }
  return name;
}

export function joinCloudStoragePath(...parts: string[]): string {
  return normalizeCloudStoragePath(parts.filter(Boolean).join('/'));
}

export function parseCloudStorageList(output: string, basePath: string): CloudStorageEntry[] {
  const parsed: unknown = JSON.parse(output || '[]');
  if (!Array.isArray(parsed)) throw new Error('Rclone trả về danh sách cloud storage không hợp lệ.');
  const normalizedBase = normalizeCloudStoragePath(basePath);
  return parsed.flatMap((raw): CloudStorageEntry[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as RcloneListItem;
    const relativePath = typeof item.Path === 'string'
      ? item.Path
      : typeof item.Name === 'string'
        ? item.Name
        : '';
    const name = typeof item.Name === 'string' ? item.Name : relativePath.split('/').filter(Boolean).at(-1) ?? '';
    if (!name || name === '.keep') return [];
    const isDirectory = item.IsDir === true;
    return [{
      name,
      path: joinCloudStoragePath(normalizedBase, relativePath),
      isDirectory,
      size: typeof item.Size === 'number' && Number.isFinite(item.Size) ? Math.max(0, item.Size) : 0,
      modTime: typeof item.ModTime === 'string' ? item.ModTime : '',
      mimeType: typeof item.MimeType === 'string' ? item.MimeType : '',
    }];
  }).sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, 'vi', { numeric: true, sensitivity: 'base' });
  });
}

export function buildCloudStorageListArgs(config: CloudStorageTargetConfig): string[] {
  const target = buildRemoteBase(config.remoteName, normalizeCloudStoragePath(config.path));
  return ['lsjson', target, '--max-depth', '1', ...COMMON_ARGS];
}

async function resolveRclone(remoteName: string): Promise<string> {
  const status = await inspectRclone();
  if (!status.available) throw new Error(status.message);
  if (!status.remotes.some((remote) => remote.name === remoteName)) {
    throw new Error('Remote rclone đã chọn không còn tồn tại. Hãy tải lại danh sách remote.');
  }
  const rclonePath = await getRclonePath();
  if (!rclonePath) throw new Error('Không tìm thấy rclone phù hợp với hệ điều hành này.');
  return rclonePath;
}

function parentPath(value: string): string {
  const normalized = normalizeCloudStoragePath(value);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function lastPathPart(value: string): string {
  return normalizeCloudStoragePath(value).split('/').at(-1) ?? '';
}

async function assertDestinationDoesNotExist(
  rclonePath: string,
  remoteName: string,
  destinationPath: string,
): Promise<void> {
  const safeDestinationPath = normalizeCloudStoragePath(destinationPath);
  const destinationName = lastPathPart(safeDestinationPath);
  const result = await runRcloneCommand(rclonePath, [
    'lsjson',
    buildRemoteBase(remoteName, parentPath(safeDestinationPath)),
    '--max-depth', '1',
    ...COMMON_ARGS,
  ], 90_000);
  const entries = parseCloudStorageList(result.stdout, parentPath(safeDestinationPath));
  if (entries.some((entry) => entry.name === destinationName)) {
    throw new Error(`Đích ${safeDestinationPath} đã tồn tại. Hãy chọn tên hoặc đường dẫn khác để tránh ghi đè.`);
  }
}

export function assertCloudStorageRelocation(sourcePath: string, destinationPath: string, isDirectory: boolean): void {
  if (typeof isDirectory !== 'boolean') throw new Error('Loại mục cloud storage không hợp lệ.');
  if (lastPathPart(destinationPath) === '.keep') throw new Error('Tên .keep được dành riêng cho marker thư mục của ứng dụng.');
  if (isDirectory && destinationPath.startsWith(`${sourcePath}/`)) {
    throw new Error('Không thể sao chép hoặc di chuyển thư mục vào bên trong chính nó.');
  }
}

export async function listCloudStorage(config: CloudStorageTargetConfig): Promise<CloudStorageListResult> {
  const safePath = normalizeCloudStoragePath(config.path);
  const rclonePath = await resolveRclone(config.remoteName);
  const result = await runRcloneCommand(rclonePath, buildCloudStorageListArgs({ ...config, path: safePath }), 90_000);
  return { remoteName: config.remoteName, path: safePath, entries: parseCloudStorageList(result.stdout, safePath) };
}

export async function createCloudStorageFolder(config: CloudStorageCreateFolderConfig): Promise<CloudStorageOperationResult> {
  const safePath = joinCloudStoragePath(config.path, validateCloudStorageName(config.name));
  const rclonePath = await resolveRclone(config.remoteName);
  // Object storage has virtual folders. A hidden marker makes an empty folder visible until it receives real files.
  await runRcloneCommand(rclonePath, ['touch', buildRemoteBase(config.remoteName, joinCloudStoragePath(safePath, '.keep')), ...COMMON_ARGS], 90_000);
  return { path: safePath, message: `Đã tạo thư mục ${safePath}.` };
}

async function runConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await task(current);
    }
  }));
}

export async function uploadCloudStorageFiles(config: CloudStorageUploadFilesConfig): Promise<CloudStorageOperationResult> {
  if (!Array.isArray(config.sourcePaths) || config.sourcePaths.length === 0 || config.sourcePaths.length > 500) {
    throw new Error('Hãy chọn từ 1 đến 500 file để upload.');
  }
  const destinationPath = normalizeCloudStoragePath(config.path);
  const rclonePath = await resolveRclone(config.remoteName);
  const sourcePaths = [...new Set(config.sourcePaths)];
  await runConcurrent(sourcePaths, 4, async (sourcePath) => {
    if (typeof sourcePath !== 'string' || !sourcePath || sourcePath.length > 4_000) throw new Error('Đường dẫn file local không hợp lệ.');
    const sourceInfo = await stat(sourcePath);
    if (!sourceInfo.isFile()) throw new Error(`${path.basename(sourcePath)} không phải là file.`);
    const fileName = validateCloudStorageName(path.basename(sourcePath));
    const target = buildRemoteBase(config.remoteName, joinCloudStoragePath(destinationPath, fileName));
    await runRcloneCommand(rclonePath, ['copyto', sourcePath, target, ...COMMON_ARGS], 30 * 60_000);
  });
  return { path: destinationPath, message: `Đã upload ${sourcePaths.length} file lên ${buildRemoteBase(config.remoteName, destinationPath)}.` };
}

export async function uploadCloudStorageFolder(config: CloudStorageUploadFolderConfig): Promise<CloudStorageOperationResult> {
  if (typeof config.sourcePath !== 'string' || !config.sourcePath || config.sourcePath.length > 4_000) {
    throw new Error('Đường dẫn thư mục local không hợp lệ.');
  }
  const sourceInfo = await stat(config.sourcePath);
  if (!sourceInfo.isDirectory()) throw new Error('Nguồn upload phải là thư mục.');
  const folderName = validateCloudStorageName(path.basename(config.sourcePath));
  const destinationPath = joinCloudStoragePath(config.path, folderName);
  const rclonePath = await resolveRclone(config.remoteName);
  await runRcloneCommand(rclonePath, [
    'copy', config.sourcePath, buildRemoteBase(config.remoteName, destinationPath), ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: destinationPath, message: `Đã upload thư mục ${folderName} lên cloud storage.` };
}

export async function renameCloudStorageEntry(config: CloudStorageRenameConfig): Promise<CloudStorageOperationResult> {
  const sourcePath = normalizeCloudStoragePath(config.path);
  if (!sourcePath) throw new Error('Không thể đổi tên thư mục gốc của remote.');
  const destinationPath = joinCloudStoragePath(parentPath(sourcePath), validateCloudStorageName(config.newName));
  if (sourcePath === destinationPath) return { path: sourcePath, message: 'Tên mới không thay đổi.' };
  assertCloudStorageRelocation(sourcePath, destinationPath, config.isDirectory);
  const rclonePath = await resolveRclone(config.remoteName);
  await assertDestinationDoesNotExist(rclonePath, config.remoteName, destinationPath);
  await runRcloneCommand(rclonePath, [
    'moveto',
    buildRemoteBase(config.remoteName, sourcePath),
    buildRemoteBase(config.remoteName, destinationPath),
    '--immutable',
    ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: destinationPath, message: `Đã đổi tên thành ${destinationPath}.` };
}

export async function copyCloudStorageEntry(config: CloudStorageCopyConfig): Promise<CloudStorageOperationResult> {
  const sourcePath = normalizeCloudStoragePath(config.path);
  const destinationPath = normalizeCloudStoragePath(config.destinationPath);
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) throw new Error('Đường dẫn nguồn hoặc đích sao chép không hợp lệ.');
  assertCloudStorageRelocation(sourcePath, destinationPath, config.isDirectory);
  const rclonePath = await resolveRclone(config.remoteName);
  await assertDestinationDoesNotExist(rclonePath, config.remoteName, destinationPath);
  await runRcloneCommand(rclonePath, [
    'copyto',
    buildRemoteBase(config.remoteName, sourcePath),
    buildRemoteBase(config.remoteName, destinationPath),
    '--immutable',
    ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: destinationPath, message: `Đã sao chép tới ${destinationPath}.` };
}

export async function moveCloudStorageEntry(config: CloudStorageMoveConfig): Promise<CloudStorageOperationResult> {
  const sourcePath = normalizeCloudStoragePath(config.path);
  const destinationPath = normalizeCloudStoragePath(config.destinationPath);
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) throw new Error('Đường dẫn nguồn hoặc đích di chuyển không hợp lệ.');
  assertCloudStorageRelocation(sourcePath, destinationPath, config.isDirectory);
  const rclonePath = await resolveRclone(config.remoteName);
  await assertDestinationDoesNotExist(rclonePath, config.remoteName, destinationPath);
  await runRcloneCommand(rclonePath, [
    'moveto',
    buildRemoteBase(config.remoteName, sourcePath),
    buildRemoteBase(config.remoteName, destinationPath),
    '--immutable',
    ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: destinationPath, message: `Đã di chuyển tới ${destinationPath}.` };
}

export async function deleteCloudStorageEntry(config: CloudStorageDeleteConfig): Promise<CloudStorageOperationResult> {
  const targetPath = normalizeCloudStoragePath(config.path);
  if (!targetPath) throw new Error('Không thể xóa toàn bộ remote từ ứng dụng.');
  const rclonePath = await resolveRclone(config.remoteName);
  await runRcloneCommand(rclonePath, [
    config.isDirectory ? 'purge' : 'deletefile',
    buildRemoteBase(config.remoteName, targetPath),
    ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: parentPath(targetPath), message: `Đã xóa ${targetPath}.` };
}

export async function downloadCloudStorageEntry(
  config: CloudStorageDownloadConfig & { localPath: string },
): Promise<CloudStorageOperationResult> {
  const sourcePath = normalizeCloudStoragePath(config.path);
  if (!sourcePath || typeof config.localPath !== 'string' || !config.localPath || config.localPath.length > 4_000) {
    throw new Error('Đường dẫn tải xuống không hợp lệ.');
  }
  const rclonePath = await resolveRclone(config.remoteName);
  await runRcloneCommand(rclonePath, [
    config.isDirectory ? 'copy' : 'copyto',
    buildRemoteBase(config.remoteName, sourcePath),
    config.localPath,
    ...COMMON_ARGS,
  ], 30 * 60_000);
  return { path: sourcePath, localPath: config.localPath, message: `Đã tải ${sourcePath} về ${config.localPath}.` };
}
