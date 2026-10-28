import type { SectionOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  hiddenSlides,
  isSectionSelected,
  moveTarget,
  sectionOf,
  sectionRows,
} from './sections';

const SLIDES = [10, 11, 12, 13, 14];
const section = (id: string, slideIds: number[]): SectionOutline => ({
  id,
  name: id,
  slideIds,
});

describe('section rows', () => {
  it('puts each header before its first slide', () => {
    const rows = sectionRows(
      [section('a', [10, 11]), section('b', [12, 13, 14])],
      SLIDES
    );
    expect(rows.map((r) => [r.section.id, r.index, r.before])).toEqual([
      ['a', 0, 0],
      ['b', 1, 2],
    ]);
  });

  it('places empty sections after the previous section, or at the end', () => {
    const rows = sectionRows(
      [
        section('empty-first', []),
        section('a', [10, 11]),
        section('empty-mid', []),
        section('b', [12, 13, 14]),
        section('empty-last', []),
      ],
      SLIDES
    );
    expect(rows.map((r) => r.before)).toEqual([0, 0, 2, 2, 5]);
  });

  it('has no rows without sections', () => {
    expect(sectionRows(undefined, SLIDES)).toEqual([]);
  });

  it('hides the slides of collapsed sections', () => {
    const sections = [section('a', [10, 11]), section('b', [12, 13, 14])];
    expect([...hiddenSlides(sections, new Set(['b']))]).toEqual([12, 13, 14]);
    expect(hiddenSlides(sections, new Set()).size).toBe(0);
    expect(sectionOf(sections, 13)?.id).toBe('b');
    expect(sectionOf(sections, 99)).toBeUndefined();
  });

  it('moves sections up and down within bounds', () => {
    const sections = [section('a', [10]), section('b', [11]), section('c', [])];
    expect(moveTarget(sections, 'b', -1)).toBe(0);
    expect(moveTarget(sections, 'b', 1)).toBe(2);
    expect(moveTarget(sections, 'a', -1)).toBeUndefined();
    expect(moveTarget(sections, 'c', 1)).toBeUndefined();
    expect(moveTarget(sections, 'zzz', 1)).toBeUndefined();
  });

  it('knows when a section is the selection', () => {
    const s = section('a', [10, 11]);
    expect(isSectionSelected(s, [11, 10])).toBe(true);
    expect(isSectionSelected(s, [10])).toBe(false);
    expect(isSectionSelected(s, [10, 11, 12])).toBe(false);
    expect(isSectionSelected(section('e', []), [])).toBe(false);
  });
});
