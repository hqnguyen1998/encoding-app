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
