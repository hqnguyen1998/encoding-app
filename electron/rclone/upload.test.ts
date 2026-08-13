import { describe, expect, it } from 'vitest';
import {
  buildRcloneUploadArgs,
  buildRemoteDestination,
  normalizeDestinationPath,
  parseRcloneStatsLine,
} from './upload';

const config = {
  sourcePath: '/tmp/My-Phim-hls',
  remoteName: 'r2',
  destinationPath: '/bucket/hls/',
  performanceId: 'fast' as const,
};

describe('rclone destination', () => {
  it('normalizes a remote path and appends the HLS folder name', () => {
    expect(normalizeDestinationPath(' /bucket//series/ ')).toBe('bucket/series');
    expect(buildRemoteDestination(config)).toBe('r2:bucket/hls/My-Phim-hls');
  });

  it('rejects path traversal and a second remote separator', () => {
    expect(() => normalizeDestinationPath('bucket/../secret')).toThrow('không được chứa');
    expect(() => normalizeDestinationPath('bucket:other')).toThrow('dấu hai chấm');
  });

  it('builds a non-destructive rclone copy command', () => {
    const args = buildRcloneUploadArgs(config).join(' ');
    expect(args).toContain('copy /tmp/My-Phim-hls r2:bucket/hls/My-Phim-hls');
    expect(args).toContain('--use-json-log');
    expect(args).toContain('--transfers 24');
    expect(args).toContain('--checkers 32');
    expect(args).toContain('--buffer-size 8M');
    expect(args).toContain('--s3-no-check-bucket');
    expect(args).not.toContain('sync');
    expect(args).not.toContain('delete');
  });

  it('maps all upload performance profiles to bounded rclone concurrency', () => {
    expect(buildRcloneUploadArgs({ ...config, performanceId: 'stable' }).join(' '))
      .toContain('--transfers 8 --checkers 16 --buffer-size 16M');
    expect(buildRcloneUploadArgs({ ...config, performanceId: 'maximum' }).join(' '))
      .toContain('--transfers 32 --checkers 64 --buffer-size 8M');
  });
});

describe('parseRcloneStatsLine', () => {
  it('converts JSON stats into upload progress', () => {
    const progress = parseRcloneStatsLine(JSON.stringify({
      stats: {
        bytes: 512,
        totalBytes: 1024,
        speed: 256,
        eta: 2,
        transfers: 3,
        totalTransfers: 8,
      },
    }));
    expect(progress).toMatchObject({
      percent: 50,
      bytes: 512,
      totalBytes: 1024,
      speedBytesPerSecond: 256,
      etaSeconds: 2,
      files: 3,
      totalFiles: 8,
    });
  });

  it('ignores normal log lines', () => {
    expect(parseRcloneStatsLine('{"level":"info","msg":"Copied"}')).toBeNull();
    expect(parseRcloneStatsLine('not json')).toBeNull();
  });
});
