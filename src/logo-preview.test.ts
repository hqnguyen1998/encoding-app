import { describe, expect, it } from 'vitest';
import type { LogoOverlaySettings } from '../shared/types';
import { logoPreviewStyle } from './logo-preview';

const settings: LogoOverlaySettings = {
  enabled: true,
  path: '/assets/logo.png',
  position: 'top-right',
  widthPercent: 15,
  opacityPercent: 85,
  marginPercent: 2,
};

describe('logoPreviewStyle', () => {
  it('matches FFmpeg width, opacity and top-right margin semantics', () => {
    expect(logoPreviewStyle(settings, 1920, 1080)).toEqual({
      width: '15%',
      opacity: 0.85,
      top: '3.5556%',
      right: '2%',
    });
  });

  it('positions a logo in the bottom-left corner', () => {
    expect(logoPreviewStyle({ ...settings, position: 'bottom-left' }, 1280, 720)).toMatchObject({
      bottom: '3.5556%',
      left: '2%',
    });
  });

  it('centers a logo independently from the configured margin', () => {
    expect(logoPreviewStyle({ ...settings, position: 'center' }, 1920, 1080)).toMatchObject({
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    });
  });
});
