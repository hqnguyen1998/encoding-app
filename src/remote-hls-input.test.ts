import { describe, expect, it } from 'vitest';
import { isValidRemoteHlsUrl, parseRemoteHlsUrlLines } from './remote-hls-input';

describe('parseRemoteHlsUrlLines', () => {
  it('trims blank lines and keeps one entry for duplicate URLs', () => {
    expect(parseRemoteHlsUrlLines(`
      https://cdn.example.com/a/master.m3u8

      https://cdn.example.com/b/playlist.m3u8?token=abc
      https://cdn.example.com/a/master.m3u8
    `)).toEqual([
      'https://cdn.example.com/a/master.m3u8',
      'https://cdn.example.com/b/playlist.m3u8?token=abc',
    ]);
  });
});

describe('isValidRemoteHlsUrl', () => {
  it('accepts HTTP(S) playlists, including signed query strings', () => {
    expect(isValidRemoteHlsUrl('https://cdn.example.com/video/master.m3u8?token=secret')).toBe(true);
    expect(isValidRemoteHlsUrl('http://localhost/live/playlist.m3u8')).toBe(true);
  });

  it('rejects non-playlists and unsupported protocols', () => {
    expect(isValidRemoteHlsUrl('https://cdn.example.com/video.mp4')).toBe(false);
    expect(isValidRemoteHlsUrl('file:///tmp/master.m3u8')).toBe(false);
    expect(isValidRemoteHlsUrl('not-a-url')).toBe(false);
  });
});
