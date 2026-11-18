import { describe, expect, it } from 'vitest';
import {
  mergeSectionOrder,
  reorderSection,
  replaceVisibleSectionOrder,
  sectionDropEdge,
} from './section-order';

describe('section order', () => {
  it('moves down after the target and up before it without mutating inputs', () => {
    const keys = ['first', 'middle', 'last'];
    expect(reorderSection(keys, 'first', 'last')).toEqual([
      'middle',
      'last',
      'first',
    ]);
    expect(reorderSection(keys, 'last', 'first')).toEqual([
      'last',
      'first',
      'middle',
    ]);
    expect(keys).toEqual(['first', 'middle', 'last']);
    expect(sectionDropEdge(keys, 'first', 'last')).toBe('bottom');
    expect(sectionDropEdge(keys, 'last', 'first')).toBe('top');
  });
  it.each([
    ['first', 'first'],
    ['gone', 'first'],
    ['first', 'gone'],
  ])('ignores a no-op or missing endpoint: %s → %s', (source, target) => {
    expect(reorderSection(['first', 'last'], source, target)).toBeUndefined();
    expect(sectionDropEdge(['first', 'last'], source, target)).toBeUndefined();
  });
  it('preserves hidden slots and introduces newly visible sections once', () => {
    expect(
      replaceVisibleSectionOrder(
        ['first', 'hidden', 'last'],
        ['last', 'first', 'new']
      )
    ).toEqual(['last', 'hidden', 'first', 'new']);
  });
  it('keeps new sections at their default positions while restoring known order', () => {
    expect(
      mergeSectionOrder(
        ['first', 'new', 'middle', 'last'],
        ['last', 'first', 'middle']
      )
    ).toEqual(['last', 'new', 'first', 'middle']);
    expect(
      mergeSectionOrder(['new', 'first', 'last'], ['last', 'first'])
    ).toEqual(['new', 'last', 'first']);
  });
  it('drops removed keys and duplicates without losing unsaved defaults', () => {
    expect(
      mergeSectionOrder(
        ['first', 'middle', 'last'],
        ['gone', 'last', 'last', 'first']
      )
    ).toEqual(['last', 'middle', 'first']);
    expect(mergeSectionOrder(['first', 'last'], [])).toEqual(['first', 'last']);
    expect(mergeSectionOrder([], ['gone'])).toEqual([]);
    expect(
      mergeSectionOrder(['first', 'first', 'last'], ['last', 'first'])
    ).toEqual(['last', 'first']);
  });
});
