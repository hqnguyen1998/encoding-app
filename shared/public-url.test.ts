import { describe, expect, it } from 'vitest';
import { buildPublicHlsUrl, normalizePublicBaseUrl } from './public-url';

describe('R2 public HLS URL', () => {
  it('removes the bucket from the object URL and appends master.m3u8', () => {
    expect(buildPublicHlsUrl({
      publicBaseUrl: 'https://cdn.daophim.space/',
      destinationPath: '/daophim-files/hls/',
      sourcePath: '/tmp/My Movie-hls',
    })).toBe('https://cdn.daophim.space/hls/My%20Movie-hls/master.m3u8');
  });

  it('preserves a path prefix in the public base URL', () => {
    expect(buildPublicHlsUrl({
      publicBaseUrl: 'https://example.r2.dev/media',
      destinationPath: 'bucket',
      sourcePath: 'C:\\video\\episode-hls',
    })).toBe('https://example.r2.dev/media/episode-hls/master.m3u8');
  });

  it('returns an empty value when no public base URL is configured', () => {
    expect(buildPublicHlsUrl({ publicBaseUrl: '', destinationPath: 'bucket/hls', sourcePath: '/tmp/movie-hls' })).toBe('');
  });

  it('rejects API-like invalid URL input instead of emitting a broken link', () => {
    expect(() => normalizePublicBaseUrl('cdn.example.com')).toThrow('URL public');
    expect(() => normalizePublicBaseUrl('ftp://cdn.example.com')).toThrow('https://');
  });
});
