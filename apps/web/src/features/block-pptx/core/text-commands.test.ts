import type { TextLayoutInfo } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { formatState, stepFontSize } from './formatting';
import {
  advance,
  deleteCommand,
  formatRange,
  insertCommand,
  normalizeText,
} from './text-commands';

const target = { slide: 256, shape: 2 };
const run = (start: number, end: number, bold: boolean, size = 18) => ({
  start,
  end,
  bold,
  italic: false,
  underline: false,
  strike: false,
  size,
  font: 'Calibri',
});

const layout: TextLayoutInfo = {
  transform: [1, 0, 0, 1, 0, 0],
  size: [100, 100],
  paragraphs: ['Hello world', 'x'],
  lines: [
    {
      paragraph: 0,
      top: 0,
      baseline: 10,
      bottom: 12,
      stops: Array.from({ length: 12 }, (_, i) => ({ index: i, x: i * 5 })),
    },
    {
      paragraph: 1,
      top: 12,
      baseline: 22,
      bottom: 24,
      stops: [
        { index: 0, x: 0 },
        { index: 1, x: 5 },
      ],
    },
  ],
  styles: [
    {
      align: 'left',
      level: 0,
      bullet: true,
      runs: [run(0, 6, true), run(6, 11, false, 24)],
      end: run(11, 11, false),
    },
    {
      align: 'center',
      level: 0,
      bullet: false,
      runs: [run(0, 1, true)],
      end: run(1, 1, true),
    },
  ],
};

describe('typing', () => {
  it('replaces a selection and predicts the caret', () => {
    const cmd = insertCommand(
      target,
      {
        anchor: { paragraph: 0, offset: 6 },
        focus: { paragraph: 0, offset: 11 },
      },
      'there\nfriend'
    );
    expect(cmd.ops).toEqual([
      {
        op: 'deleteText',
        ...target,
        start: { paragraph: 0, offset: 6 },
        end: { paragraph: 0, offset: 11 },
      },
      {
        op: 'insertText',
        ...target,
        at: { paragraph: 0, offset: 6 },
        text: 'there\nfriend',
      },
    ]);
    expect(cmd.caret).toEqual({ paragraph: 1, offset: 6 });
  });

  it('counts characters by code point and normalizes line endings', () => {
    expect(advance({ paragraph: 0, offset: 1 }, '😀a')).toEqual({
      paragraph: 0,
      offset: 3,
    });
    expect(normalizeText('a\r\nb\u0007')).toBe('a\nb');
  });
});

describe('deleting', () => {
  it('joins paragraphs on backspace at a paragraph start', () => {
    const at = { paragraph: 1, offset: 0 };
    const cmd = deleteCommand(target, layout, { anchor: at, focus: at }, -1);
    expect(cmd?.ops).toEqual([
      {
        op: 'deleteText',
        ...target,
        start: { paragraph: 0, offset: 11 },
        end: at,
      },
    ]);
    expect(cmd?.caret).toEqual({ paragraph: 0, offset: 11 });
  });

  it('deletes words and does nothing at the edges', () => {
    const at = { paragraph: 0, offset: 11 };
    expect(
      deleteCommand(target, layout, { anchor: at, focus: at }, -1, 'word')
        ?.caret
    ).toEqual({ paragraph: 0, offset: 6 });
    const start = { paragraph: 0, offset: 0 };
    expect(
      deleteCommand(target, layout, { anchor: start, focus: start }, -1)
    ).toBeNull();
  });
});

describe('formatting state', () => {
  it('reports a mixed range as not bold and uses the first size', () => {
    const state = formatState(layout, [
      { paragraph: 0, offset: 2 },
      { paragraph: 0, offset: 8 },
    ]);
    expect(state.bold).toBe(false);
    expect(state.size).toBe(18);
    expect(state.bullet).toBe(true);
    expect(
      formatState(layout, [
        { paragraph: 0, offset: 0 },
        { paragraph: 0, offset: 6 },
      ]).bold
    ).toBe(true);
  });

  it('uses the character before a collapsed caret', () => {
    const caret = { paragraph: 0, offset: 8 };
    expect(formatState(layout, [caret, caret]).size).toBe(24);
    expect(formatState(layout, null).align).toBe('left');
  });

  it('formats the word at a collapsed caret', () => {
    const caret = { paragraph: 0, offset: 8 };
    expect(formatRange(layout, { anchor: caret, focus: caret })).toEqual([
      { paragraph: 0, offset: 6 },
      { paragraph: 0, offset: 11 },
    ]);
  });

  it('steps font sizes along the standard ladder', () => {
    expect(stepFontSize(18, 1)).toBe(20);
    expect(stepFontSize(18, -1)).toBe(16);
    expect(stepFontSize(19, -1)).toBe(18);
    expect(stepFontSize(96, 1)).toBe(106);
  });
});
