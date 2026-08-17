import { describe, expect, it } from 'vitest';
import type { OnzloadUploadConfig } from '../../shared/types';
import { buildOnzloadRcloneArgs, buildOnzloadRcloneEnvironment, parseRcloneStatsLine } from './upload';

describe('buildOnzloadRcloneArgs', () => {
  it('uploads only HLS files without embedding credentials in arguments', () => {
    const config: OnzloadUploadConfig = {
      sourcePath: '/tmp/video-hls',
      originalName: 'video.mp4',
      idempotencyKey: 'desktop-0123456789abcdef',
      segmentDuration: 4,
      performanceId: 'fast',
    };
    const args = buildOnzloadRcloneArgs(config, 'onzloadtmp:bucket/hls-output/user/asset/');
    expect(args.slice(0, 3)).toEqual([
      'copy',
      '/tmp/video-hls',
      'onzloadtmp:bucket/hls-output/user/asset/',
    ]);
    expect(args).toContain('--s3-no-check-bucket');
    expect(args.filter((value) => value === '--include')).toHaveLength(4);
    expect(args.join(' ')).not.toMatch(/access.?key|secret.?key|session.?token/i);
  });

  it('uses only the temporary OnzLoad remote and ignores user rclone config', () => {
    const environment = buildOnzloadRcloneEnvironment({
      uploadId: 'upload-1',
      assetId: 'asset-1',
      jobId: 'job-1',
      outputPrefix: 'hls-output/user/asset',
      playlistKey: 'hls-output/user/asset/master.m3u8',
      completed: false,
      embedPath: '/embed/asset-1',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'onzload-bucket',
      region: 'auto',
      credentials: {
        accessKeyId: 'temporary-access-key',
        secretAccessKey: 'temporary-secret-key',
        sessionToken: 'temporary-session-token',
        expiresAt: '2026-08-17T04:00:00.000Z',
      },
    });

    expect(environment.RCLONE_CONFIG).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(environment.RCLONE_CONFIG_ONZLOADTMP_TYPE).toBe('s3');
    expect(environment.RCLONE_CONFIG_ONZLOADTMP_ACCESS_KEY_ID).toBe('temporary-access-key');
    expect(environment.RCLONE_CONFIG_ONZLOADTMP_SESSION_TOKEN).toBe('temporary-session-token');
  });
});

describe('parseRcloneStatsLine', () => {
  it('parses rclone JSON progress without ever reporting completion early', () => {
    expect(parseRcloneStatsLine(JSON.stringify({
      stats: {
        bytes: 50,
        totalBytes: 100,
        speed: 25,
        eta: 2,
        transfers: 2,
        totalTransfers: 4,
      },
    }))).toEqual({
      percent: 50,
      bytes: 50,
      totalBytes: 100,
      speedBytesPerSecond: 25,
      etaSeconds: 2,
      files: 2,
      totalFiles: 4,
    });
    expect(parseRcloneStatsLine(JSON.stringify({
      stats: { bytes: 100, totalBytes: 100 },
    }))?.percent).toBe(99.5);
  });

  it('ignores non-stat and malformed log lines', () => {
    expect(parseRcloneStatsLine('{not-json')).toBeNull();
    expect(parseRcloneStatsLine(JSON.stringify({ msg: 'copied' }))).toBeNull();
  });
});
