import type { EditOp } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { clickSlide, moveSlidesOps } from './slide-selection';

const ORDER = [10, 11, 12, 13, 14];

/** Applies moveSlide ops to an id list. */
const run = (order: number[], ops: EditOp[]) => {
  const list = [...order];
  for (const op of ops) {
    if (op.op !== 'moveSlide') throw new Error(op.op);
    list.splice(list.indexOf(op.slide), 1);
    list.splice(op.to, 0, op.slide);
  }
  return list;
};

describe('slide selection', () => {
  it('selects, toggles, and extends like PowerPoint', () => {
    let sel = clickSlide(ORDER, { ids: [10], anchor: 10 }, 11, {
      shift: false,
      toggle: false,
    });
    expect(sel).toEqual({ ids: [11], anchor: 11 });
    sel = clickSlide(ORDER, sel, 13, { shift: true, toggle: false });
    expect(sel.ids).toEqual([11, 12, 13]);
    sel = clickSlide(ORDER, sel, 12, { shift: false, toggle: true });
    expect(sel.ids).toEqual([11, 13]);
    sel = clickSlide(ORDER, sel, 10, { shift: false, toggle: true });
    expect(sel.ids).toEqual([10, 11, 13]);
    // Toggling off the only selected slide keeps it.
    const one = { ids: [12], anchor: 12 };
    expect(clickSlide(ORDER, one, 12, { shift: false, toggle: true })).toBe(
      one
    );
  });

  it('moves a scattered block to the end, keeping its order', () => {
    const ops = moveSlidesOps(ORDER, [11, 13], 5);
    expect(run(ORDER, ops)).toEqual([10, 12, 14, 11, 13]);
  });

  it('moves a block to the front and into the middle', () => {
    expect(run(ORDER, moveSlidesOps(ORDER, [13, 14], 0))).toEqual([
      13, 14, 10, 11, 12,
    ]);
    expect(run(ORDER, moveSlidesOps(ORDER, [10, 14], 2))).toEqual([
      11, 10, 14, 12, 13,
    ]);
    expect(moveSlidesOps(ORDER, [11], 1)).toEqual([]);
  });
});
