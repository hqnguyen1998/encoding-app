import type { AdvancedEncodeSettings } from './types';

export const DEFAULT_ADVANCED_ENCODE_SETTINGS: AdvancedEncodeSettings = {
  videoBitratePercent: 100,
  cpuCrf: null,
  h264Profile: 'main',
  outputFps: 'source',
  keyframeIntervalSeconds: 'segment',
  scaleAlgorithm: 'lanczos',
  deinterlace: false,
  audioBitrateKbps: null,
  audioChannels: 2,
  audioSampleRate: 'source',
  hlsSegmentType: 'mpegts',
  startNumber: 0,
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function nullableFiniteNumber(value: unknown, min: number, max: number): number | null {
  if (value == null) return null;
  const numeric = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : null;
}

export function normalizeAdvancedEncodeSettings(
  input: Partial<AdvancedEncodeSettings> | null | undefined,
): AdvancedEncodeSettings {
  const settings = input ?? {};
  const outputFps = settings.outputFps == null || settings.outputFps === 'source'
    ? 'source'
    : finiteNumber(settings.outputFps, 30, 1, 120);
  const keyframeIntervalSeconds = settings.keyframeIntervalSeconds == null || settings.keyframeIntervalSeconds === 'segment'
    ? 'segment'
    : finiteNumber(settings.keyframeIntervalSeconds, 2, 0.5, 10);

  return {
    videoBitratePercent: Math.round(finiteNumber(settings.videoBitratePercent, 100, 25, 300)),
    cpuCrf: nullableFiniteNumber(settings.cpuCrf, 0, 51),
    h264Profile: settings.h264Profile === 'baseline' || settings.h264Profile === 'high'
      ? settings.h264Profile
      : 'main',
    outputFps,
    keyframeIntervalSeconds,
    scaleAlgorithm: settings.scaleAlgorithm === 'fast_bilinear' || settings.scaleAlgorithm === 'bicubic'
      ? settings.scaleAlgorithm
      : 'lanczos',
    deinterlace: settings.deinterlace === true,
    audioBitrateKbps: nullableFiniteNumber(settings.audioBitrateKbps, 32, 512),
    audioChannels: settings.audioChannels === 'source' || settings.audioChannels === 1 || settings.audioChannels === 6
      ? settings.audioChannels
      : 2,
    audioSampleRate: settings.audioSampleRate === 44_100 || settings.audioSampleRate === 48_000
      ? settings.audioSampleRate
      : 'source',
    hlsSegmentType: settings.hlsSegmentType === 'fmp4' ? 'fmp4' : 'mpegts',
    startNumber: Math.round(finiteNumber(settings.startNumber, 0, 0, 999_999)),
  };
}
