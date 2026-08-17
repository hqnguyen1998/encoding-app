import { describe, expect, it } from 'vitest';
import {
  assertCloudStorageRelocation,
  buildCloudStorageListArgs,
  joinCloudStoragePath,
  normalizeCloudStoragePath,
  parseCloudStorageList,
  validateCloudStorageName,
} from './storage';

describe('cloud storage path validation', () => {
  it('normalizes safe object paths and rejects traversal', () => {
    expect(normalizeCloudStoragePath('/bucket//media/hls/')).toBe('bucket/media/hls');
    expect(joinCloudStoragePath('bucket/media', 'episode-01')).toBe('bucket/media/episode-01');
    expect(() => normalizeCloudStoragePath('bucket/../secret')).toThrow('không được chứa');
    expect(() => normalizeCloudStoragePath('remote:bucket')).toThrow('dấu hai chấm');
  });

  it('accepts a single object name and rejects path separators', () => {
    expect(validateCloudStorageName('Tập 01.m3u8')).toBe('Tập 01.m3u8');
    expect(() => validateCloudStorageName('../movie')).toThrow('Tên chỉ được dùng');
    expect(() => validateCloudStorageName('folder/file')).toThrow('Tên chỉ được dùng');
    expect(() => validateCloudStorageName('.keep')).toThrow('Tên chỉ được dùng');
  });

  it('prevents a folder from being copied or moved into its own descendant', () => {
    expect(() => assertCloudStorageRelocation('bucket/hls', 'bucket/hls/archive', true)).toThrow('bên trong chính nó');
    expect(() => assertCloudStorageRelocation('bucket/master.m3u8', 'bucket/archive/master.m3u8', false)).not.toThrow();
    expect(() => assertCloudStorageRelocation('bucket/master.m3u8', 'bucket/.keep', false)).toThrow('dành riêng');
  });
});

describe('cloud storage list parsing', () => {
  it('maps lsjson output, hides folder markers, and sorts folders first', () => {
    const entries = parseCloudStorageList(JSON.stringify([
      { Path: 'z.ts', Name: 'z.ts', Size: 12, MimeType: 'video/mp2t', ModTime: '2026-08-13T10:00:00Z', IsDir: false },
      { Path: 'Season 1', Name: 'Season 1', Size: -1, IsDir: true },
      { Path: '.keep', Name: '.keep', Size: 0, IsDir: false },
      { Path: 'master.m3u8', Name: 'master.m3u8', Size: 7, IsDir: false },
    ]), 'bucket/media');

    expect(entries.map((entry) => entry.name)).toEqual(['Season 1', 'master.m3u8', 'z.ts']);
    expect(entries[0]).toMatchObject({ path: 'bucket/media/Season 1', isDirectory: true, size: 0 });
    expect(entries[1]).toMatchObject({ path: 'bucket/media/master.m3u8', mimeType: '' });
  });

  it('builds a non-recursive list command without shell interpolation', () => {
    expect(buildCloudStorageListArgs({ remoteName: 'r2', path: 'bucket/media' })).toEqual([
      'lsjson', 'r2:bucket/media', '--max-depth', '1',
      '--contimeout', '30s', '--timeout', '5m', '--retries', '2', '--low-level-retries', '4', '--ask-password=false',
    ]);
  });
});
