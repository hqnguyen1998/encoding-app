import { describe, expect, it } from 'vitest';
import { encodeStartBlocker, uploadStartBlocker, type PipelineActivity } from './pipeline-concurrency';

const idle: PipelineActivity = {
  encodeActive: false,
  uploadActive: false,
  remoteHlsDownloadActive: false,
  subtitleExportActive: false,
  cloudStorageMutationActive: false,
};

describe('encode/upload pipeline concurrency', () => {
  it('allows the next encode while an upload is active', () => {
    expect(encodeStartBlocker({ ...idle, uploadActive: true })).toBeNull();
  });

  it('allows upload while the next encode is active', () => {
    expect(uploadStartBlocker({ ...idle, encodeActive: true })).toBeNull();
  });

  it('allows a downloaded HLS item to upload while the next URL is downloading', () => {
    expect(uploadStartBlocker({ ...idle, remoteHlsDownloadActive: true })).toBeNull();
  });

  it('still blocks two jobs of the same kind and shared storage operations', () => {
    expect(encodeStartBlocker({ ...idle, encodeActive: true })).toContain('encode khác');
    expect(uploadStartBlocker({ ...idle, uploadActive: true })).toContain('upload khác');
    expect(uploadStartBlocker({ ...idle, cloudStorageMutationActive: true })).toContain('cloud storage');
  });
});
