import path from 'node:path';
import { normalizeAdvancedEncodeSettings } from '../../shared/encode-settings';
import { normalizeLogoOverlaySettings } from '../../shared/logo-overlay';
import { PRESETS, SPEEDS, type RenditionDefinition } from '../../shared/presets';
import type { AdvancedEncodeSettings, EncodeConfig, MediaInfo } from '../../shared/types';

export interface ResolvedRendition extends RenditionDefinition {
  width: number;
}

export interface EncodeCommand {
  args: string[];
  renditions: ResolvedRendition[];
}

function overlayCoordinates(
  position: ReturnType<typeof normalizeLogoOverlaySettings>['position'],
  margin: number,
): { x: string; y: string } {
  if (position === 'top-left') return { x: String(margin), y: String(margin) };
  if (position === 'top-right') return { x: `W-w-${margin}`, y: String(margin) };
  if (position === 'bottom-left') return { x: String(margin), y: `H-h-${margin}` };
  if (position === 'center') return { x: '(W-w)/2', y: '(H-h)/2' };
  return { x: `W-w-${margin}`, y: `H-h-${margin}` };
}

function appendHlsMuxerArgs(
  args: string[],
  media: MediaInfo,
  renditions: ResolvedRendition[],
  outputPath: string,
  segmentDuration: number,
  advanced: AdvancedEncodeSettings,
): void {
  const variantMap = renditions
    .map((_, index) => (media.hasAudio ? `v:${index},a:${index}` : `v:${index}`))
    .join(' ');

  const segmentExtension = advanced.hlsSegmentType === 'fmp4' ? 'm4s' : 'ts';

  args.push(
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'hls',
    '-hls_time',
    String(segmentDuration),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_segment_type',
    advanced.hlsSegmentType,
    '-master_pl_name',
    'master.m3u8',
    '-hls_segment_filename',
    path.join(outputPath, 'v%v', `segment_%05d.${segmentExtension}`),
  );

  if (advanced.hlsSegmentType === 'fmp4') {
    args.push('-hls_fmp4_init_filename', 'init_%v.mp4');
  }
  if (advanced.startNumber > 0) {
    args.push('-start_number', String(advanced.startNumber));
  }

  args.push(
    '-var_stream_map',
    variantMap,
    path.join(outputPath, 'v%v', 'index.m3u8'),
  );
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function sourceBitrate(height: number): number {
  if (height >= 2160) return 12_000;
  if (height >= 1440) return 8_000;
  if (height >= 1080) return 6_000;
  if (height >= 720) return 3_000;
  if (height >= 480) return 1_400;
  return 800;
}

export function safeBaseName(fileName: string): string {
  const extension = path.extname(fileName);
  const withoutExtension = path.basename(fileName, extension);
  const sanitized = withoutExtension
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || 'video';
}

export function resolveRenditions(media: MediaInfo, presetId: EncodeConfig['presetId']): ResolvedRendition[] {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('Preset HLS không hợp lệ.');

  if (preset.renditions === 'source') {
    const height = even(media.height);
    return [
      {
        label: `${height}p`,
        height,
        width: even((media.width / media.height) * height),
        videoBitrateKbps: sourceBitrate(height),
        audioBitrateKbps: 160,
      },
    ];
  }

  let selected = preset.renditions.filter((rendition) => rendition.height <= media.height + 8);
  if (selected.length === 0) {
    const smallest = preset.renditions[preset.renditions.length - 1];
    const height = even(media.height);
    selected = [
      {
        ...smallest,
        label: `${height}p`,
        height,
        videoBitrateKbps: Math.min(smallest.videoBitrateKbps, sourceBitrate(height)),
      },
    ];
  }

  return selected.map((rendition) => ({
    ...rendition,
    width: even((media.width / media.height) * rendition.height),
  }));
}

export function buildEncodeCommand(
  config: EncodeConfig,
  media: MediaInfo,
  outputPath: string,
): EncodeCommand {
  const renditions = resolveRenditions(media, config.presetId);
  const speed = SPEEDS.find((item) => item.id === config.speedId);
  if (!speed) throw new Error('Cấu hình tốc độ không hợp lệ.');

  const segmentDuration = Math.min(10, Math.max(2, Math.round(config.segmentDuration)));
  const advanced = normalizeAdvancedEncodeSettings(config.advanced);
  const logoOverlay = normalizeLogoOverlaySettings(config.logoOverlay);
  const fps = advanced.outputFps === 'source' ? Math.max(1, media.fps) : advanced.outputFps;
  const keyframeInterval = advanced.keyframeIntervalSeconds === 'segment'
    ? segmentDuration
    : advanced.keyframeIntervalSeconds;
  const gop = Math.max(1, Math.round(fps * keyframeInterval));
  const args: string[] = ['-hide_banner', '-y', '-i', config.inputPath];
  if (logoOverlay.enabled) {
    if (!logoOverlay.path) throw new Error('Hãy chọn ảnh logo trước khi encode.');
    args.push('-loop', '1', '-i', logoOverlay.path);
  }

  if (config.presetId === 'copy-source') {
    if (logoOverlay.enabled) {
      throw new Error('Đóng logo cần encode lại video; không thể dùng chế độ Copy.');
    }
    if (media.videoCodec.toLowerCase() !== 'h264') {
      throw new Error('Chế độ Copy video chỉ hỗ trợ nguồn H.264 để đảm bảo HLS tương thích trình duyệt.');
    }
    args.push('-map', '0:v:0');
    if (media.hasAudio) args.push('-map', '0:a:0');
    args.push('-c:v', 'copy');
    // MP4/MOV store H.264 NAL units with length prefixes, while MPEG-TS expects
    // Annex B start codes. Apply the conversion explicitly because FFmpeg's HLS
    // muxer does not reliably auto-insert it for every source file.
    if (advanced.hlsSegmentType === 'mpegts') {
      args.push('-bsf:v', 'h264_mp4toannexb');
    }
    if (media.hasAudio) {
      args.push('-c:a', 'aac');
      if (advanced.audioChannels !== 'source') args.push('-ac', String(advanced.audioChannels));
      if (advanced.audioSampleRate !== 'source') args.push('-ar', String(advanced.audioSampleRate));
      args.push('-b:a', `${Math.round(advanced.audioBitrateKbps ?? 192)}k`);
    }
    appendHlsMuxerArgs(args, media, renditions, outputPath, segmentDuration, advanced);
    return { args, renditions };
  }

  const splitOutputs = renditions.map((_, index) => `[v${index}]`).join('');
  const filters = [`[0:v:0]split=${renditions.length}${splitOutputs}`];
  if (logoOverlay.enabled) {
    const logoSplitOutputs = renditions.map((_, index) => `[logo${index}]`).join('');
    filters.push(`[1:v:0]split=${renditions.length}${logoSplitOutputs}`);
  }
  renditions.forEach((rendition, index) => {
    const chain: string[] = [];
    if (advanced.deinterlace) chain.push('yadif=mode=send_frame:parity=auto:deint=interlaced');
    if (advanced.outputFps !== 'source') chain.push(`fps=fps=${advanced.outputFps}`);
    chain.push(`scale=w=${rendition.width}:h=${rendition.height}:flags=${advanced.scaleAlgorithm}`);
    chain.push('setsar=1', 'format=yuv420p');
    const baseOutput = logoOverlay.enabled ? `[v${index}base]` : `[v${index}out]`;
    filters.push(`[v${index}]${chain.join(',')}${baseOutput}`);

    if (logoOverlay.enabled) {
      const logoWidth = even(rendition.width * logoOverlay.widthPercent / 100);
      const margin = Math.max(0, Math.round(rendition.width * logoOverlay.marginPercent / 100));
      const opacity = (logoOverlay.opacityPercent / 100).toFixed(2);
      const { x, y } = overlayCoordinates(logoOverlay.position, margin);
      filters.push(
        `[logo${index}]scale=w=${logoWidth}:h=-2:flags=lanczos,format=rgba,colorchannelmixer=aa=${opacity}[logo${index}scaled]`,
      );
      filters.push(
        `[v${index}base][logo${index}scaled]overlay=x=${x}:y=${y}:shortest=1,format=yuv420p[v${index}out]`,
      );
    }
  });
  args.push('-filter_complex', filters.join(';'));

  renditions.forEach((_, index) => {
    args.push('-map', `[v${index}out]`);
    if (media.hasAudio) args.push('-map', '0:a:0');
  });

  const requestedEncoder = config.videoEncoderId && config.videoEncoderId !== 'auto'
    ? config.videoEncoderId
    : 'libx264';
  args.push('-c:v', requestedEncoder, '-profile:v', advanced.h264Profile, '-pix_fmt', 'yuv420p');

  if (requestedEncoder === 'libx264') {
    args.push('-preset', speed.x264Preset);
  } else if (requestedEncoder === 'h264_videotoolbox') {
    args.push('-allow_sw', '0', '-prio_speed', config.speedId === 'fast' ? '1' : '0');
  } else if (requestedEncoder === 'h264_nvenc') {
    const nvencPreset = config.speedId === 'fast' ? 'p3' : config.speedId === 'quality' ? 'p6' : 'p5';
    args.push('-preset', nvencPreset, '-tune', 'hq', '-rc', 'vbr');
  } else if (requestedEncoder === 'h264_qsv') {
    const qsvPreset = config.speedId === 'fast' ? 'faster' : config.speedId === 'quality' ? 'slow' : 'medium';
    args.push('-preset', qsvPreset);
  } else if (requestedEncoder === 'h264_amf') {
    const amfQuality = config.speedId === 'fast' ? 'speed' : config.speedId === 'quality' ? 'quality' : 'balanced';
    args.push('-quality', amfQuality, '-usage', 'transcoding');
  }

  renditions.forEach((rendition, index) => {
    const videoBitrateKbps = Math.max(1, Math.round(rendition.videoBitrateKbps * advanced.videoBitratePercent / 100));
    if (requestedEncoder === 'libx264') {
      args.push(`-crf:v:${index}`, String(advanced.cpuCrf ?? speed.crf));
    } else {
      args.push(`-b:v:${index}`, `${videoBitrateKbps}k`);
    }
    args.push(
      `-maxrate:v:${index}`,
      `${videoBitrateKbps}k`,
      `-bufsize:v:${index}`,
      `${videoBitrateKbps * 2}k`,
      `-g:v:${index}`,
      String(gop),
      `-keyint_min:v:${index}`,
      String(gop),
      `-sc_threshold:v:${index}`,
      '0',
    );
  });

  if (media.hasAudio) {
    args.push('-c:a', 'aac');
    if (advanced.audioChannels !== 'source') args.push('-ac', String(advanced.audioChannels));
    if (advanced.audioSampleRate !== 'source') args.push('-ar', String(advanced.audioSampleRate));
    renditions.forEach((rendition, index) => {
      args.push(`-b:a:${index}`, `${Math.round(advanced.audioBitrateKbps ?? rendition.audioBitrateKbps)}k`);
    });
  }

  appendHlsMuxerArgs(args, media, renditions, outputPath, segmentDuration, advanced);

  return { args, renditions };
}
