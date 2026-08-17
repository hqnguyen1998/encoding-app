import { describe, expect, it } from 'vitest';
import { encodeStartBlocker, uploadStartBlocker, type PipelineActivity } from './pipeline-concurrency';

const idle: PipelineActivity = {
  encodeActive: false,
  uploadActive: false,
  subtitleExportActive: false,
};

describe('encode/upload pipeline concurrency', () => {
  it('allows the next encode while an upload is active', () => {
    expect(encodeStartBlocker({ ...idle, uploadActive: true })).toBeNull();
  });

  it('allows upload while the next encode is active', () => {
    expect(uploadStartBlocker({ ...idle, encodeActive: true })).toBeNull();
  });

  it('still blocks two jobs of the same kind', () => {
    expect(encodeStartBlocker({ ...idle, encodeActive: true })).toContain('encode khác');
    expect(uploadStartBlocker({ ...idle, uploadActive: true })).toContain('upload khác');
  });
});
