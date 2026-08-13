import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '../../shared/types';
import { createSubtitleExportPlan, createSubtitleFileName } from './export';

function track(overrides: Partial<SubtitleTrack> = {}): SubtitleTrack {
  return {
    streamIndex: 3,
    ordinal: 0,
    codec: 'subrip',
    language: 'vie',
    title: 'Vietnamese',
    kind: 'text',
    extension: 'srt',
    formatLabel: 'SRT',
    isDefault: true,
    isForced: false,
    ...overrides,
  };
}

describe('subtitle export names', () => {
  it('uses the absolute stream index and language', () => {
    expect(createSubtitleFileName('Phim Đẹp Tập 01.mkv', track())).toBe('Phim-Dep-Tap-01.track-3.vie.srt');
  });

  it('uses und when a language tag is missing', () => {
    expect(createSubtitleFileName('movie.mkv', track({ language: null }))).toBe('movie.track-3.und.srt');
  });
});

describe('subtitle FFmpeg plans', () => {
  it('copies embedded SRT without re-encoding', () => {
    const output = path.join('/output', 'movie.track-3.vie.srt');
    const plan = createSubtitleExportPlan('/video/movie.mkv', output, track());
    expect(plan.args.join(' ')).toContain('-map 0:3');
    expect(plan.args.join(' ')).toContain('-c:s copy');
  });

  it('converts mov_text to SRT', () => {
    const output = path.join('/output', 'movie.track-2.eng.srt');
    const plan = createSubtitleExportPlan('/video/movie.mp4', output, track({ streamIndex: 2, codec: 'mov_text' }));
    expect(plan.args.join(' ')).toContain('-map 0:2');
    expect(plan.args.join(' ')).toContain('-c:s srt');
  });

  it('exports PGS as a raw SUP file', () => {
    const output = path.join('/output', 'movie.track-7.jpn.sup');
    const plan = createSubtitleExportPlan(
      '/video/movie.mkv',
      output,
      track({ streamIndex: 7, codec: 'hdmv_pgs_subtitle', kind: 'image', extension: 'sup' }),
    );
    expect(plan.args.join(' ')).toContain('-c:s copy');
    expect(plan.args.join(' ')).toContain('-f sup');
  });
});
