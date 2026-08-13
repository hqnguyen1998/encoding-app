import { describe, expect, it } from 'vitest';
import { encoderCandidates, parseAvailableEncoderNames, resolveVideoEncoder } from './hardware';

describe('hardware encoder detection', () => {
  it('parses encoder names from ffmpeg output', () => {
    const names = parseAvailableEncoderNames(`
 V....D libx264              libx264 H.264
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder
`);
    expect([...names]).toEqual(['libx264', 'h264_videotoolbox', 'h264_nvenc']);
  });

  it('uses platform-specific GPU priority', () => {
    expect(encoderCandidates('darwin').map((item) => item.id)).toEqual(['h264_videotoolbox']);
    expect(encoderCandidates('win32').map((item) => item.id)).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf']);
  });

  it('selects the recommended encoder for auto and falls back to CPU', () => {
    const status = {
      encoders: [
        { id: 'libx264' as const, label: 'CPU · x264', hardware: false },
        { id: 'h264_videotoolbox' as const, label: 'GPU · Apple VideoToolbox', hardware: true },
      ],
      recommendedId: 'h264_videotoolbox' as const,
      message: '',
    };
    expect(resolveVideoEncoder('auto', status).id).toBe('h264_videotoolbox');
    expect(resolveVideoEncoder('h264_nvenc', status).id).toBe('libx264');
  });
});
