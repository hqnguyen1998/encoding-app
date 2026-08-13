import { describe, expect, it } from 'vitest';
import { DEFAULT_ADVANCED_ENCODE_SETTINGS, normalizeAdvancedEncodeSettings } from './encode-settings';

describe('normalizeAdvancedEncodeSettings', () => {
  it('keeps the backward-compatible defaults for a missing config', () => {
    expect(normalizeAdvancedEncodeSettings(undefined)).toEqual(DEFAULT_ADVANCED_ENCODE_SETTINGS);
  });

  it('clamps numeric values and rejects unsupported enum values', () => {
    expect(normalizeAdvancedEncodeSettings({
      videoBitratePercent: 999,
      cpuCrf: -4,
      outputFps: 500,
      keyframeIntervalSeconds: 0.1,
      audioBitrateKbps: 999,
      startNumber: -10,
      h264Profile: 'invalid' as never,
      hlsSegmentType: 'invalid' as never,
    })).toMatchObject({
      videoBitratePercent: 300,
      cpuCrf: 0,
      outputFps: 120,
      keyframeIntervalSeconds: 0.5,
      audioBitrateKbps: 512,
      startNumber: 0,
      h264Profile: 'main',
      hlsSegmentType: 'mpegts',
    });
  });
});
