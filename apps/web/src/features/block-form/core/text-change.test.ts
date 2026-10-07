import { describe, expect, it } from 'vitest';
import { mapSelection, rebaseEdit, textChange } from './text-change';

describe('textChange', () => {
  it('finds the one span that differs', () => {
    expect(textChange('Introduction', 'Updated introduction')).toEqual({
      start: 0,
      removed: 1,
      inserted: 'Updated i',
    });
    expect(textChange('Hello world', 'Hello brave world')).toEqual({
      start: 6,
      removed: 0,
      inserted: 'brave ',
    });
    expect(textChange('Hello world', 'Hello')).toEqual({
      start: 5,
      removed: 6,
      inserted: '',
    });
  });

  it('is empty when nothing changed', () => {
    expect(textChange('Same', 'Same')).toEqual({
      start: 4,
      removed: 0,
      inserted: '',
    });
  });
});

describe('mapSelection', () => {
  it('keeps a caret where it is when text is inserted after it', () => {
    const change = textChange('Hello world', 'Hello world, again');
    expect(mapSelection({ start: 3, end: 3 }, change)).toEqual({
      start: 3,
      end: 3,
    });
  });

  it('moves a caret by what was inserted before it', () => {
    // The browser repro: the caret after "Intro" stays after "intro".
    const change = textChange('Introduction', 'Updated introduction');
    expect(mapSelection({ start: 5, end: 5 }, change)).toEqual({
      start: 13,
      end: 13,
    });
  });

  it('keeps a caret before text inserted exactly at it', () => {
    const change = textChange('ab', 'aXb');
    expect(mapSelection({ start: 1, end: 1 }, change)).toEqual({
      start: 1,
      end: 1,
    });
  });

  it('moves a caret back by what was deleted before it', () => {
    const change = textChange('Hello brave world', 'Hello world');
    expect(mapSelection({ start: 14, end: 14 }, change)).toEqual({
      start: 8,
      end: 8,
    });
  });

  it('puts a caret inside deleted text where the deletion was', () => {
    const change = textChange('Hello brave world', 'Hello world');
    expect(mapSelection({ start: 8, end: 8 }, change)).toEqual({
      start: 6,
      end: 6,
    });
  });

  it('keeps a selection on its own text when its neighbours change', () => {
    // "brave" selected; text goes in before it and at its end.
    const before = textChange('Hello brave world', 'Oh hello brave world');
    expect(mapSelection({ start: 6, end: 11 }, before)).toEqual({
      start: 9,
      end: 14,
    });
    const atEnd = textChange('Hello brave world', 'Hello braveX world');
    expect(mapSelection({ start: 6, end: 11 }, atEnd)).toEqual({
      start: 6,
      end: 11,
    });
    const atStart = textChange('Hello brave world', 'Hello Xbrave world');
    expect(mapSelection({ start: 6, end: 11 }, atStart)).toEqual({
      start: 7,
      end: 12,
    });
  });

  it('shrinks a selection to what survives a replacement through it', () => {
    // "brave world" selected; "brave wo" is replaced by "bold".
    const change = textChange('Hello brave world', 'Hello boldrld');
    expect(change).toEqual({ start: 7, removed: 7, inserted: 'old' });
    expect(mapSelection({ start: 6, end: 17 }, change)).toEqual({
      start: 6,
      end: 13,
    });
    // A selection wholly inside the replaced text collapses after it.
    expect(mapSelection({ start: 8, end: 10 }, change)).toEqual({
      start: 10,
      end: 10,
    });
  });
});

describe('rebaseEdit', () => {
  it('is the local text when nothing else changed', () => {
    expect(rebaseEdit('Title', 'Title!', 'Title')).toBe('Title!');
  });

  it('keeps both a local and a concurrent edit', () => {
    // The person composed "日本" at the end while someone fixed the start.
    expect(rebaseEdit('hello', 'hello 日本', 'Hello')).toBe('Hello 日本');
    expect(rebaseEdit('a b', 'a X b', 'a b c')).toBe('a X b c');
  });

  it('is the concurrent text when the person changed nothing', () => {
    expect(rebaseEdit('a', 'a', 'b')).toBe('b');
  });
});
