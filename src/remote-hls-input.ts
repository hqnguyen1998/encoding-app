export function parseRemoteHlsUrlLines(value: string): string[] {
  return [...new Set(value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean))];
}

export function isValidRemoteHlsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && /\.m3u8$/i.test(url.pathname);
  } catch {
    return false;
  }
}
