import type { RunStyle } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  paintRangeOps,
  paintShapesOps,
  runAt,
  runPatchOf,
} from './format-painter';

const run = (start: number, end: number, extra: Partial<RunStyle> = {}) => ({
  start,
  end,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  size: 18,
  font: 'Calibri',
  ...extra,
});

describe('format painter', () => {
  it('finds the run formatting a character', () => {
    const paragraph = {
      align: 'left' as const,
      level: 0,
      bullet: false,
      runs: [run(0, 3), run(3, 8, { bold: true })],
      end: run(8, 8),
    };
    expect(runAt(paragraph, 4)?.bold).toBe(true);
    expect(runAt(paragraph, 8)?.bold).toBe(true);
    expect(runAt({ ...paragraph, runs: [] }, 0)).toBe(paragraph.end);
  });

  it('turns a resolved run into a full patch, clearing what it lacks', () => {
    expect(runPatchOf(run(0, 1, { color: '#FF0000' }))).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      size: 18,
      font: 'Calibri',
      baseline: 0,
      highlight: '',
      color: 'FF0000',
    });
  });

  it('paints the look once and the text of each text shape', () => {
    const ops = paintShapesOps(
      { slide: 1, shape: 2, look: true, run: run(0, 1) },
      7,
      [
        { id: 3, textEditable: true },
        { id: 4, textEditable: false },
      ]
    );
    expect(ops.map((o) => o.op)).toEqual(['pasteFormat', 'formatText']);
    expect(ops[0]).toMatchObject({ slide: 7, shapes: [3, 4], fromShape: 2 });
  });

  it('paints only character formatting onto a range', () => {
    const start = { paragraph: 0, offset: 1 };
    const end = { paragraph: 0, offset: 4 };
    expect(
      paintRangeOps(
        { slide: 1, shape: 2, look: false },
        { slide: 1, shape: 3, start, end }
      )
    ).toEqual([]);
    const [op] = paintRangeOps(
      { slide: 1, shape: 2, look: false, run: run(0, 1) },
      { slide: 1, shape: 3, start, end }
    );
    expect(op).toMatchObject({ op: 'formatText', shape: 3, start, end });
  });
});
