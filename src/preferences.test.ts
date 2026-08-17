import { describe, expect, it } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  type StorageLike,
} from './preferences';

function memoryStorage(initialValue: string | null = null): StorageLike {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (key, nextValue) => {
      expect(key).toBe(APP_PREFERENCES_KEY);
      value = nextValue;
    },
  };
}

describe('app preferences', () => {
  it('restores encode settings but discards obsolete local storage configuration', () => {
    const preferences = {
      ...DEFAULT_APP_PREFERENCES,
      activeTab: 'upload' as const,
      encode: {
        ...DEFAULT_APP_PREFERENCES.encode,
        outputDirectory: '/video/hls',
        presetId: 'adaptive-1080' as const,
        segmentDuration: 4,
        videoEncoderId: 'h264_videotoolbox' as const,
        advancedSettings: {
          ...DEFAULT_APP_PREFERENCES.encode.advancedSettings,
          cpuCrf: 19,
        },
        logoOverlay: {
          enabled: true,
          path: '/assets/dao-logo.png',
          position: 'bottom-right' as const,
          widthPercent: 12,
          opacityPercent: 90,
          marginPercent: 2,
        },
      },
      upload: {
        selectedRemote: 'dao-r2',
        remoteDestinationPath: 'media/hls',
        uploadAfterEncode: true,
        performanceId: 'maximum' as const,
        cloudStoragePath: 'daophim-files/media',
      },
      remoteDraft: {
        provider: 'Cloudflare' as const,
        name: 'dao-r2',
        accessKeyId: 'access-id',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
      },
    };

    const legacyStorage = memoryStorage(JSON.stringify(preferences));
    const restored = loadAppPreferences(legacyStorage);
    expect(restored.activeTab).toBe('onzload');
    expect(restored.encode).toEqual(preferences.encode);
    expect(restored.upload.performanceId).toBe('maximum');
    expect(JSON.stringify(restored)).not.toContain('access-id');
  });

  it('uses safe defaults for malformed or unsupported saved values', () => {
    const storage = memoryStorage(JSON.stringify({
      activeTab: 'broken',
      encode: { presetId: 'unknown', segmentDuration: 999, advancedSettings: { hlsSegmentType: 'bad' } },
      upload: { uploadAfterEncode: 'yes' },
    }));
    const preferences = loadAppPreferences(storage);

    expect(preferences.activeTab).toBe('encode');
    expect(preferences.encode.presetId).toBe('copy-source');
    expect(preferences.encode.segmentDuration).toBe(10);
    expect(preferences.encode.advancedSettings.hlsSegmentType).toBe('mpegts');
    expect(preferences.upload.performanceId).toBe('fast');
  });

  it('recovers when storage contains invalid JSON', () => {
    expect(loadAppPreferences(memoryStorage('{not-json'))).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('does not restore the obsolete URL upload tab', () => {
    const storage = memoryStorage(JSON.stringify({ activeTab: 'url-upload' }));
    const restored = loadAppPreferences(storage);
    expect(restored.activeTab).toBe('encode');
    expect(JSON.stringify(restored)).not.toContain('m3u8');
  });

  it('does not restore the obsolete cloud storage manager or browsing path', () => {
    const storage = memoryStorage(JSON.stringify({
      activeTab: 'storage',
      upload: { cloudStoragePath: 'daophim-files/media/HLS' },
    }));
    const restored = loadAppPreferences(storage);
    expect(restored.activeTab).toBe('encode');
    expect(restored.upload).toEqual(DEFAULT_APP_PREFERENCES.upload);
  });
});
