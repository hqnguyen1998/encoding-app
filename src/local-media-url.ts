export function localMediaUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');

  if (normalized.startsWith('//')) return `file:${encoded}`;
  if (normalized.startsWith('/')) return `file://${encoded}`;
  return `file:///${encoded}`;
}
