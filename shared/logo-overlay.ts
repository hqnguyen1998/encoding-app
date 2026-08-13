import type { LogoOverlaySettings } from './types';

export const DEFAULT_LOGO_OVERLAY_SETTINGS: LogoOverlaySettings = {
  enabled: false,
  path: '',
  position: 'top-right',
  widthPercent: 15,
  opacityPercent: 85,
  marginPercent: 2,
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeLogoOverlaySettings(
  input: Partial<LogoOverlaySettings> | null | undefined,
): LogoOverlaySettings {
  const settings = input ?? {};
  const positions: LogoOverlaySettings['position'][] = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'center',
  ];

  return {
    enabled: settings.enabled === true,
    path: typeof settings.path === 'string' && settings.path.length <= 4_000 ? settings.path : '',
    position: positions.includes(settings.position as LogoOverlaySettings['position'])
      ? settings.position as LogoOverlaySettings['position']
      : DEFAULT_LOGO_OVERLAY_SETTINGS.position,
    widthPercent: Math.round(finiteNumber(settings.widthPercent, DEFAULT_LOGO_OVERLAY_SETTINGS.widthPercent, 3, 50)),
    opacityPercent: Math.round(finiteNumber(settings.opacityPercent, DEFAULT_LOGO_OVERLAY_SETTINGS.opacityPercent, 10, 100)),
    marginPercent: Math.round(finiteNumber(settings.marginPercent, DEFAULT_LOGO_OVERLAY_SETTINGS.marginPercent, 0, 10) * 10) / 10,
  };
}
