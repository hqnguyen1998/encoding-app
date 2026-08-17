import { describe, expect, it } from 'vitest';
import type { OnzloadUploadConfig } from '../../shared/types';
import { buildOnzloadRcloneArgs } from './upload';

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
});
