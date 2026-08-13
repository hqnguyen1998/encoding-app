import type { PresetId, SpeedId } from './types';

export interface RenditionDefinition {
  label: string;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

export interface PresetDefinition {
  id: PresetId;
  name: string;
  shortName: string;
  description: string;
  videoMode: 'copy' | 'transcode';
  renditions: RenditionDefinition[] | 'source';
}

export const PRESETS: PresetDefinition[] = [
  {
    id: 'copy-source',
    name: 'Siêu nhanh · Copy',
    shortName: 'Copy',
    description: 'Giữ video gốc · AAC 192k',
    videoMode: 'copy',
    renditions: 'source',
  },
  {
    id: 'adaptive-1080',
    name: 'Adaptive 1080p',
    shortName: '1080p',
    description: '1080p · 720p · 480p',
    videoMode: 'transcode',
    renditions: [
      { label: '1080p', height: 1080, videoBitrateKbps: 6000, audioBitrateKbps: 160 },
      { label: '720p', height: 720, videoBitrateKbps: 3000, audioBitrateKbps: 128 },
      { label: '480p', height: 480, videoBitrateKbps: 1400, audioBitrateKbps: 96 },
    ],
  },
  {
    id: 'adaptive-720',
    name: 'Adaptive 720p',
    shortName: '720p',
    description: '720p · 480p · 360p',
    videoMode: 'transcode',
    renditions: [
      { label: '720p', height: 720, videoBitrateKbps: 3000, audioBitrateKbps: 128 },
      { label: '480p', height: 480, videoBitrateKbps: 1400, audioBitrateKbps: 96 },
      { label: '360p', height: 360, videoBitrateKbps: 800, audioBitrateKbps: 96 },
    ],
  },
  {
    id: 'single-source',
    name: 'Một chất lượng',
    shortName: 'Gốc',
    description: 'Giữ nguyên độ phân giải nguồn',
    videoMode: 'transcode',
    renditions: 'source',
  },
];

export const SPEEDS: Array<{
  id: SpeedId;
  name: string;
  description: string;
  x264Preset: 'veryfast' | 'medium' | 'slow';
  crf: number;
}> = [
  { id: 'fast', name: 'Nhanh', description: 'Tốc độ ưu tiên', x264Preset: 'veryfast', crf: 21 },
  { id: 'balanced', name: 'Cân bằng', description: 'Khuyên dùng', x264Preset: 'medium', crf: 20 },
  { id: 'quality', name: 'Chất lượng', description: 'File tối ưu hơn', x264Preset: 'slow', crf: 19 },
];
