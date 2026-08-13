import type { LogoOverlaySettings } from '../shared/types';

export interface LogoPreviewStyle {
  width: string;
  opacity: number;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  transform?: string;
}

function percent(value: number): string {
  return `${Math.round(value * 10_000) / 10_000}%`;
}

export function logoPreviewStyle(
  settings: LogoOverlaySettings,
  videoWidth: number,
  videoHeight: number,
): LogoPreviewStyle {
  const safeWidth = Math.max(1, videoWidth);
  const safeHeight = Math.max(1, videoHeight);
  const horizontalMargin = percent(settings.marginPercent);
  const verticalMargin = percent(settings.marginPercent * safeWidth / safeHeight);
  const base = {
    width: percent(settings.widthPercent),
    opacity: settings.opacityPercent / 100,
  };

  if (settings.position === 'top-left') {
    return { ...base, top: verticalMargin, left: horizontalMargin };
  }
  if (settings.position === 'top-right') {
    return { ...base, top: verticalMargin, right: horizontalMargin };
  }
  if (settings.position === 'bottom-left') {
    return { ...base, bottom: verticalMargin, left: horizontalMargin };
  }
  if (settings.position === 'center') {
    return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  return { ...base, right: horizontalMargin, bottom: verticalMargin };
}
