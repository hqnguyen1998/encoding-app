import { describe, expect, it } from 'vitest';
import type { EncodeConfig, MediaInfo } from '../../shared/types';
import { resolveOutputFps } from './job';

const media: MediaInfo = {
  path: '/video/movie.mp4',
  name: 'movie.mp4',
  sizeBytes: 1_000,
  durationSeconds: 120,
  width: 1920,
  height: 1080,
  fps: 23.976,
  videoCodec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  subtitleTracks: [],
};

const config: EncodeConfig = {
  inputPath: media.path,
  outputDirectory: '/output',
  presetId: 'single-source',
  speedId: 'balanced',
  segmentDuration: 6,
};

describe('resolveOutputFps', () => {
  it('shows the source frame rate instead of FFmpeg processing throughput', () => {
    expect(resolveOutputFps(config, media)).toBe(23.976);
  });

  it('shows the configured output frame rate when video is re-encoded', () => {
    expect(resolveOutputFps({ ...config, advanced: { outputFps: 25 } }, media)).toBe(25);
  });

  it('keeps the source frame rate in copy mode because FPS conversion is not applied', () => {
    expect(resolveOutputFps({ ...config, presetId: 'copy-source', advanced: { outputFps: 60 } }, media)).toBe(23.976);
  });
});
