interface PublicHlsUrlConfig {
  publicBaseUrl?: string;
  destinationPath: string;
  sourcePath: string;
}

export function normalizePublicBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('URL public phải là URL đầy đủ, ví dụ https://cdn.daophim.space');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('URL public phải bắt đầu bằng https:// hoặc http:// và không chứa thông tin đăng nhập.');
  }
  if (url.search || url.hash) {
    throw new Error('URL public không được chứa query hoặc dấu #.');
  }
  return url.toString().replace(/\/+$/, '');
}

function pathSegments(value: string): string[] {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildPublicHlsUrl(config: PublicHlsUrlConfig): string {
  const baseUrl = normalizePublicBaseUrl(config.publicBaseUrl ?? '');
  if (!baseUrl) return '';

  const destinationParts = pathSegments(config.destinationPath);
  const sourceParts = pathSegments(config.sourcePath);
  const folderName = sourceParts.at(-1);
  if (destinationParts.length === 0 || !folderName) return '';

  // Rclone S3/R2 paths start with the bucket. A bucket public domain already
  // points at that bucket root, so only the object key belongs in the URL.
  const objectParts = [...destinationParts.slice(1), folderName, 'master.m3u8'];
  const encodedObjectKey = objectParts.map((part) => encodeURIComponent(part)).join('/');
  return `${baseUrl}/${encodedObjectKey}`;
}

interface PublicStorageUrlConfig {
  publicBaseUrl?: string;
  storagePath: string;
  appendFile?: string;
  directory?: boolean;
}

export function buildPublicStorageUrl(config: PublicStorageUrlConfig): string {
  const baseUrl = normalizePublicBaseUrl(config.publicBaseUrl ?? '');
  if (!baseUrl) return '';
  const storageParts = pathSegments(config.storagePath);
  if (storageParts.length < 2) return '';
  const objectParts = [...storageParts.slice(1), ...pathSegments(config.appendFile ?? '')];
  if (objectParts.length === 0) return '';
  const encodedObjectKey = objectParts.map((part) => encodeURIComponent(part)).join('/');
  return `${baseUrl}/${encodedObjectKey}${config.directory && !config.appendFile ? '/' : ''}`;
}
