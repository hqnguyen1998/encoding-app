import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHlsValidationArgs } from './validate';

describe('buildHlsValidationArgs', () => {
  it('decodes the first video stream and treats decoder errors as fatal', () => {
    const args = buildHlsValidationArgs('/output/movie-hls');
    expect(args).toContain('-xerror');
    expect(args).toContain('0:v:0');
    expect(args).toContain('1');
    expect(args).toContain(path.join('/output/movie-hls', 'master.m3u8'));
  });
});
