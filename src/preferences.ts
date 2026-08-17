import { normalizeAdvancedEncodeSettings } from '../shared/encode-settings';
import { normalizeLogoOverlaySettings } from '../shared/logo-overlay';
import type {
  AdvancedEncodeSettings,
  LogoOverlaySettings,
  PresetId,
  RcloneProvider,
  RcloneUploadPerformanceId,
  SpeedId,
  VideoEncoderId,
} from '../shared/types';

export const APP_PREFERENCES_KEY = 'dao-phim:preferences:v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AppPreferences {
  version: 1;
  activeTab: 'encode' | 'upload' | 'url-upload' | 'storage';
  encode: {
    outputDirectory: string;
    presetId: PresetId;
    speedId: SpeedId;
    segmentDuration: number;
    videoEncoderId: VideoEncoderId;
    showAdvancedSettings: boolean;
    advancedSettings: AdvancedEncodeSettings;
    logoOverlay: LogoOverlaySettings;
  };
  upload: {
    selectedRemote: string;
    remoteDestinationPath: string;
    uploadAfterEncode: boolean;
    performanceId: RcloneUploadPerformanceId;
    cloudStoragePath: string;
  };
  remoteDraft: {
    provider: RcloneProvider;
    name: string;
    accessKeyId: string;
    endpoint: string;
    region: string;
  };
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  version: 1,
  activeTab: 'encode',
  encode: {
    outputDirectory: '',
    presetId: 'copy-source',
    speedId: 'balanced',
    segmentDuration: 6,
    videoEncoderId: 'auto',
    showAdvancedSettings: false,
    advancedSettings: normalizeAdvancedEncodeSettings(undefined),
    logoOverlay: normalizeLogoOverlaySettings(undefined),
  },
  upload: {
    selectedRemote: '',
    remoteDestinationPath: '',
    uploadAfterEncode: false,
    performanceId: 'fast',
    cloudStoragePath: '',
  },
  remoteDraft: {
    provider: 'Cloudflare',
    name: '',
    accessKeyId: '',
    endpoint: '',
    region: 'auto',
  },
};

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, fallback: string, maxLength = 4_096): string {
  return typeof value === 'string' && value.length <= maxLength ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function parsePreferences(value: unknown): AppPreferences {
  const root = record(value);
  const encode = record(root.encode);
  const upload = record(root.upload);
  const remoteDraft = record(root.remoteDraft);
  const segmentDuration = typeof encode.segmentDuration === 'number' && Number.isFinite(encode.segmentDuration)
    ? Math.min(10, Math.max(2, Math.round(encode.segmentDuration)))
    : DEFAULT_APP_PREFERENCES.encode.segmentDuration;

  return {
    version: 1,
    activeTab: oneOf(root.activeTab, ['encode', 'upload', 'url-upload', 'storage'], DEFAULT_APP_PREFERENCES.activeTab),
    encode: {
      outputDirectory: stringValue(encode.outputDirectory, '', 2_000),
      presetId: oneOf(
        encode.presetId,
        ['copy-source', 'adaptive-1080', 'adaptive-720', 'single-source'],
        DEFAULT_APP_PREFERENCES.encode.presetId,
      ),
      speedId: oneOf(encode.speedId, ['fast', 'balanced', 'quality'], DEFAULT_APP_PREFERENCES.encode.speedId),
      segmentDuration,
      videoEncoderId: oneOf(
        encode.videoEncoderId,
        ['auto', 'libx264', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf'],
        DEFAULT_APP_PREFERENCES.encode.videoEncoderId,
      ),
      showAdvancedSettings: encode.showAdvancedSettings === true,
      advancedSettings: normalizeAdvancedEncodeSettings(record(encode.advancedSettings)),
      logoOverlay: normalizeLogoOverlaySettings(record(encode.logoOverlay)),
    },
    upload: {
      selectedRemote: stringValue(upload.selectedRemote, '', 64),
      remoteDestinationPath: stringValue(upload.remoteDestinationPath, '', 1_000),
      uploadAfterEncode: upload.uploadAfterEncode === true,
      performanceId: oneOf(upload.performanceId, ['stable', 'fast', 'maximum'], DEFAULT_APP_PREFERENCES.upload.performanceId),
      cloudStoragePath: stringValue(upload.cloudStoragePath, '', 2_000),
    },
    remoteDraft: {
      provider: oneOf(remoteDraft.provider, ['Cloudflare', 'AWS', 'Other'], DEFAULT_APP_PREFERENCES.remoteDraft.provider),
      name: stringValue(remoteDraft.name, '', 64),
      accessKeyId: stringValue(remoteDraft.accessKeyId, '', 512),
      endpoint: stringValue(remoteDraft.endpoint, '', 2_000),
      region: stringValue(remoteDraft.region, DEFAULT_APP_PREFERENCES.remoteDraft.region, 128),
    },
  };
}

export function loadAppPreferences(storage: StorageLike): AppPreferences {
  try {
    const raw = storage.getItem(APP_PREFERENCES_KEY);
    return raw ? parsePreferences(JSON.parse(raw)) : parsePreferences(undefined);
  } catch {
    return parsePreferences(undefined);
  }
}

export function saveAppPreferences(storage: StorageLike, preferences: AppPreferences): boolean {
  try {
    storage.setItem(APP_PREFERENCES_KEY, JSON.stringify(parsePreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}
