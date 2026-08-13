import type { SubtitleKind } from './types';

export interface SubtitleFormatProfile {
  kind: SubtitleKind;
  extension: string;
  formatLabel: string;
  codecMode: 'copy' | 'srt';
  muxer?: 'sup' | 'matroska';
}

const DIRECT_TEXT_FORMATS: Record<string, SubtitleFormatProfile> = {
  subrip: { kind: 'text', extension: 'srt', formatLabel: 'SRT', codecMode: 'copy' },
  srt: { kind: 'text', extension: 'srt', formatLabel: 'SRT', codecMode: 'copy' },
  ass: { kind: 'text', extension: 'ass', formatLabel: 'ASS', codecMode: 'copy' },
  ssa: { kind: 'text', extension: 'ssa', formatLabel: 'SSA', codecMode: 'copy' },
  webvtt: { kind: 'text', extension: 'vtt', formatLabel: 'WebVTT', codecMode: 'copy' },
};

const CONVERTIBLE_TEXT_CODECS = new Set([
  'mov_text',
  'text',
  'mpl2',
  'microdvd',
  'sami',
  'jacosub',
  'realtext',
  'subviewer',
  'subviewer1',
  'vplayer',
  'pjs',
]);

export function getSubtitleFormatProfile(codec: string): SubtitleFormatProfile {
  const normalized = codec.toLowerCase();
  const direct = DIRECT_TEXT_FORMATS[normalized];
  if (direct) return direct;

  if (CONVERTIBLE_TEXT_CODECS.has(normalized)) {
    return { kind: 'text', extension: 'srt', formatLabel: 'SRT', codecMode: 'srt' };
  }

  if (normalized === 'hdmv_pgs_subtitle') {
    return { kind: 'image', extension: 'sup', formatLabel: 'PGS/SUP', codecMode: 'copy', muxer: 'sup' };
  }

  return {
    kind: 'image',
    extension: 'mks',
    formatLabel: normalized === 'dvd_subtitle' ? 'VobSub/MKS' : 'Image/MKS',
    codecMode: 'copy',
    muxer: 'matroska',
  };
}
