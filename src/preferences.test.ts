import { describe, expect, it } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  saveAppPreferences,
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
  it('restores encode, upload and non-secret remote fields', () => {
    const storage = memoryStorage();
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
      },
      remoteDraft: {
        provider: 'Cloudflare' as const,
        name: 'dao-r2',
        accessKeyId: 'access-id',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
      },
    };

    expect(saveAppPreferences(storage, preferences)).toBe(true);
    expect(loadAppPreferences(storage)).toMatchObject(preferences);
    expect(JSON.stringify(loadAppPreferences(storage))).not.toContain('secret');
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
    expect(preferences.upload.uploadAfterEncode).toBe(false);
    expect(preferences.upload.performanceId).toBe('fast');
  });

  it('recovers when storage contains invalid JSON', () => {
    expect(loadAppPreferences(memoryStorage('{not-json'))).toEqual(DEFAULT_APP_PREFERENCES);
  });
});
