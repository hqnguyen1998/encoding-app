import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_OVERLAY_SETTINGS, normalizeLogoOverlaySettings } from './logo-overlay';

describe('normalizeLogoOverlaySettings', () => {
  it('uses safe defaults when no logo configuration is supplied', () => {
    expect(normalizeLogoOverlaySettings(undefined)).toEqual(DEFAULT_LOGO_OVERLAY_SETTINGS);
  });

  it('clamps numeric values and rejects unsupported positions', () => {
    expect(normalizeLogoOverlaySettings({
      enabled: true,
      path: '/logo.png',
      position: 'outside' as never,
      widthPercent: 90,
      opacityPercent: 1,
      marginPercent: 12,
    })).toMatchObject({
      enabled: true,
      path: '/logo.png',
      position: 'top-right',
      widthPercent: 50,
      opacityPercent: 10,
      marginPercent: 10,
    });
  });
});
