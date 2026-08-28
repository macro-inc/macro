// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  adjacentStop,
  enterListStop,
  shownStops,
  type ThreadStop,
} from './threadStops';

const message = (index: number): ThreadStop => ({ kind: 'message', index });

describe('shownStops', () => {
  it('inserts the chip after the first card when the middle is collapsed', () => {
    expect(
      shownStops({ length: 6, showMiddle: false, hasComposer: true })
    ).toEqual([
      { kind: 'title' },
      message(0),
      { kind: 'hidden-chip' },
      message(4),
      message(5),
      { kind: 'composer' },
    ]);
  });

  it('lists every card once the middle is open', () => {
    expect(shownStops({ length: 6, showMiddle: true })).toEqual([
      { kind: 'title' },
      message(0),
      message(1),
      message(2),
      message(3),
      message(4),
      message(5),
    ]);
  });
});

describe('adjacentStop', () => {
  const collapsed = shownStops({
    length: 6,
    showMiddle: false,
    hasComposer: true,
  });

  it('treats the chip as the stop after the first card', () => {
    expect(adjacentStop(collapsed, message(0), 'next')).toEqual({
      kind: 'hidden-chip',
    });
    expect(adjacentStop(collapsed, { kind: 'hidden-chip' }, 'prev')).toEqual(
      message(0)
    );
  });

  it('treats the chip as the stop before the penultimate card', () => {
    expect(adjacentStop(collapsed, message(4), 'prev')).toEqual({
      kind: 'hidden-chip',
    });
    expect(adjacentStop(collapsed, { kind: 'hidden-chip' }, 'next')).toEqual(
      message(4)
    );
  });

  it('walks the last shown cards and the composer', () => {
    expect(adjacentStop(collapsed, message(4), 'next')).toEqual(message(5));
    expect(adjacentStop(collapsed, message(5), 'next')).toEqual({
      kind: 'composer',
    });
    expect(adjacentStop(collapsed, message(0), 'prev')).toEqual({
      kind: 'title',
    });
  });

  it('steps into the first revealed middle card once open', () => {
    const opened = shownStops({ length: 6, showMiddle: true });
    expect(adjacentStop(opened, message(0), 'next')).toEqual(message(1));
    expect(adjacentStop(opened, message(1), 'prev')).toEqual(message(0));
    expect(adjacentStop(opened, message(5), 'prev')).toEqual(message(4));
  });
});

describe('enterListStop', () => {
  it('enters at the oldest or newest shown card', () => {
    const collapsed = shownStops({ length: 6, showMiddle: false });
    expect(enterListStop(collapsed, 'next')).toEqual(message(0));
    expect(enterListStop(collapsed, 'prev')).toEqual(message(5));
  });
});
