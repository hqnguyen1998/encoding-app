import { describe, expect, it } from 'vitest';
import type { EncodeConfig, MediaInfo } from '../../shared/types';
import { buildEncodeCommand, resolveRenditions, safeBaseName } from './command';

const media: MediaInfo = {
  path: '/videos/Phim Đẹp.mkv',
  name: 'Phim Đẹp.mkv',
  sizeBytes: 1_024_000,
  durationSeconds: 120,
  width: 1920,
  height: 1080,
  fps: 29.97,
  videoCodec: 'hevc',
  audioCodec: 'aac',
  hasAudio: true,
  subtitleTracks: [],
};

const config: EncodeConfig = {
  inputPath: media.path,
  outputDirectory: '/output',
  presetId: 'adaptive-1080',
  speedId: 'balanced',
  segmentDuration: 6,
};

describe('safeBaseName', () => {
  it('creates a portable folder name from Vietnamese input', () => {
    expect(safeBaseName('Phim Đẹp Tập 01.mkv')).toBe('Phim-Dep-Tap-01');
  });

  it('falls back when the name has no portable characters', () => {
    expect(safeBaseName('🎬🎬.mp4')).toBe('video');
  });
});

describe('resolveRenditions', () => {
  it('keeps the full adaptive ladder for a 1080p source', () => {
    expect(resolveRenditions(media, 'adaptive-1080').map((item) => item.height)).toEqual([1080, 720, 480]);
  });

  it('never upscales a smaller source', () => {
    const small = { ...media, width: 854, height: 480 };
    expect(resolveRenditions(small, 'adaptive-1080').map((item) => item.height)).toEqual([480]);
  });

  it('preserves an even source resolution in single mode', () => {
    const odd = { ...media, width: 1919, height: 1079 };
    expect(resolveRenditions(odd, 'single-source')[0]).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe('buildEncodeCommand', () => {
  it('stream-copies H.264 video and only converts the first audio track to AAC', () => {
    const command = buildEncodeCommand(
      { ...config, presetId: 'copy-source' },
      { ...media, videoCodec: 'h264' },
      '/output/movie-copy-hls',
    );
    const joined = command.args.join(' ');

    expect(command.renditions).toHaveLength(1);
    expect(joined).toContain('-map 0:v:0 -map 0:a:0');
    expect(joined).toContain('-c:v copy -bsf:v h264_mp4toannexb');
    expect(joined).toContain('-c:a aac -ac 2 -b:a 192k');
    expect(joined).toContain('-var_stream_map v:0,a:0');
    expect(joined).not.toContain('-filter_complex');
    expect(joined).not.toContain('libx264');
  });

  it('rejects copy mode for non-H.264 video', () => {
    expect(() => buildEncodeCommand(
      { ...config, presetId: 'copy-source' },
      media,
      '/output/unsupported-copy',
    )).toThrow('chỉ hỗ trợ nguồn H.264');
  });

  it('builds aligned multi-variant HLS with audio', () => {
    const command = buildEncodeCommand(config, media, '/output/movie-hls');
    const joined = command.args.join(' ');

    expect(command.renditions).toHaveLength(3);
    expect(joined).toContain('-var_stream_map v:0,a:0 v:1,a:1 v:2,a:2');
    expect(joined).toContain('-hls_flags independent_segments+temp_file');
    expect(joined).toContain('-master_pl_name master.m3u8');
    expect(joined).toContain('-g:v:0 180');
    expect(joined).toContain('/output/movie-hls/v%v/segment_%05d.ts');
  });

  it('uses VideoToolbox bitrate controls instead of x264 CRF', () => {
    const command = buildEncodeCommand(
      { ...config, videoEncoderId: 'h264_videotoolbox' },
      media,
      '/output/gpu-hls',
    );
    const joined = command.args.join(' ');
    expect(joined).toContain('-c:v h264_videotoolbox');
    expect(joined).toContain('-allow_sw 0');
    expect(joined).toContain('-b:v:0 6000k');
    expect(joined).not.toContain('-crf:v:0');
    expect(joined).not.toContain('libx264');
  });

  it('maps speed choices to Windows hardware encoder presets', () => {
    expect(buildEncodeCommand({ ...config, speedId: 'fast', videoEncoderId: 'h264_nvenc' }, media, '/output/nvenc').args.join(' '))
      .toContain('-preset p3 -tune hq -rc vbr');
    expect(buildEncodeCommand({ ...config, speedId: 'quality', videoEncoderId: 'h264_qsv' }, media, '/output/qsv').args.join(' '))
      .toContain('-preset slow');
    expect(buildEncodeCommand({ ...config, videoEncoderId: 'h264_amf' }, media, '/output/amf').args.join(' '))
      .toContain('-quality balanced -usage transcoding');
  });

  it('applies advanced video, audio and fragmented MP4 HLS settings', () => {
    const command = buildEncodeCommand(
      {
        ...config,
        advanced: {
          videoBitratePercent: 75,
          cpuCrf: 18,
          h264Profile: 'high',
          outputFps: 25,
          keyframeIntervalSeconds: 2,
          scaleAlgorithm: 'bicubic',
          deinterlace: true,
          audioBitrateKbps: 192,
          audioChannels: 6,
          audioSampleRate: 48_000,
          hlsSegmentType: 'fmp4',
          startNumber: 100,
        },
      },
      media,
      '/output/advanced-hls',
    );
    const joined = command.args.join(' ');

    expect(joined).toContain('yadif=mode=send_frame:parity=auto:deint=interlaced,fps=fps=25,scale=w=1920:h=1080:flags=bicubic');
    expect(joined).toContain('-profile:v high');
    expect(joined).toContain('-crf:v:0 18 -maxrate:v:0 4500k -bufsize:v:0 9000k');
    expect(joined).toContain('-g:v:0 50 -keyint_min:v:0 50');
    expect(joined).toContain('-c:a aac -ac 6 -ar 48000 -b:a:0 192k');
    expect(joined).toContain('-hls_segment_type fmp4');
    expect(joined).toContain('-hls_fmp4_init_filename init_%v.mp4');
    expect(joined).toContain('-start_number 100');
    expect(joined).toContain('/output/advanced-hls/v%v/segment_%05d.m4s');
  });

  it('applies compatible advanced audio and HLS options in copy mode', () => {
    const command = buildEncodeCommand(
      {
        ...config,
        presetId: 'copy-source',
        advanced: {
          audioBitrateKbps: 256,
          audioChannels: 'source',
          audioSampleRate: 44_100,
          hlsSegmentType: 'fmp4',
        },
      },
      { ...media, videoCodec: 'h264' },
      '/output/copy-fmp4',
    );
    const joined = command.args.join(' ');

    expect(joined).toContain('-c:v copy -c:a aac -ar 44100 -b:a 256k');
    expect(joined).not.toContain('h264_mp4toannexb');
    expect(joined).not.toContain('-ac ');
    expect(joined).not.toContain('-filter_complex');
    expect(joined).toContain('/output/copy-fmp4/v%v/segment_%05d.m4s');
  });

  it('does not reference an audio stream when the source has none', () => {
    const command = buildEncodeCommand(config, { ...media, hasAudio: false, audioCodec: null }, '/output/silent');
    expect(command.args.join(' ')).not.toContain('a:0');
  });

  it('overlays a scaled semi-transparent logo on every adaptive rendition', () => {
    const command = buildEncodeCommand(
      {
        ...config,
        logoOverlay: {
          enabled: true,
          path: '/assets/logo.png',
          position: 'bottom-right',
          widthPercent: 15,
          opacityPercent: 80,
          marginPercent: 2,
        },
      },
      media,
      '/output/logo-hls',
    );
    const joined = command.args.join(' ');

    expect(joined).toContain('-i /videos/Phim Đẹp.mkv -loop 1 -i /assets/logo.png');
    expect(joined).toContain('[1:v:0]split=3[logo0][logo1][logo2]');
    expect(joined).toContain('[logo0]scale=w=288:h=-2:flags=lanczos,format=rgba,colorchannelmixer=aa=0.80[logo0scaled]');
    expect(joined).toContain('[v0base][logo0scaled]overlay=x=W-w-38:y=H-h-38:shortest=1,format=yuv420p[v0out]');
    expect(joined).toContain('[logo1]scale=w=192:h=-2');
    expect(joined).toContain('[logo2]scale=w=128:h=-2');
  });

  it('rejects logo overlay in stream-copy mode', () => {
    expect(() => buildEncodeCommand(
      {
        ...config,
        presetId: 'copy-source',
        logoOverlay: { enabled: true, path: '/assets/logo.png' },
      },
      { ...media, videoCodec: 'h264' },
      '/output/copy-logo',
    )).toThrow('không thể dùng chế độ Copy');
  });
});
