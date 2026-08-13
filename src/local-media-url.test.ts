import { describe, expect, it } from 'vitest';
import { localMediaUrl } from './local-media-url';

describe('localMediaUrl', () => {
  it('encodes a macOS path without losing special characters', () => {
    expect(localMediaUrl('/Users/huynguyen/Videos/Phim #1.mp4'))
      .toBe('file:///Users/huynguyen/Videos/Phim%20%231.mp4');
  });

  it('preserves the Windows drive separator', () => {
    expect(localMediaUrl('C:\\Videos\\Phim Đẹp.mp4'))
      .toBe('file:///C:/Videos/Phim%20%C4%90%E1%BA%B9p.mp4');
  });

  it('supports UNC network paths', () => {
    expect(localMediaUrl('\\\\server\\media\\movie.mp4'))
      .toBe('file://server/media/movie.mp4');
  });
});
