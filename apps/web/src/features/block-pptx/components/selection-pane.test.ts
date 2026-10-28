import type { ShapeOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import { dropSteps, siblingsOf } from './selection-pane';

/** Applies `steps` moves to sibling `from` of `ids` (back to front). */
function moved(ids: string[], from: number, steps: number) {
  const out = [...ids];
  const [item] = out.splice(from, 1);
  out.splice(from + steps, 0, item);
  return out;
}

describe('selection pane reordering', () => {
  // Back to front: A is at the back, D in front (listed first in the pane).
  const z = ['A', 'B', 'C', 'D'];

  it('drops in front of or behind a row', () => {
    // B dropped above D in the list: in front of D.
    expect(moved(z, 1, dropSteps(1, 3, false))).toEqual(['A', 'C', 'D', 'B']);
    // D dropped below A: behind A.
    expect(moved(z, 3, dropSteps(3, 0, true))).toEqual(['D', 'A', 'B', 'C']);
    // A dropped above C: just in front of C.
    expect(moved(z, 0, dropSteps(0, 2, false))).toEqual(['B', 'C', 'A', 'D']);
    // C dropped below B: just behind B.
    expect(moved(z, 2, dropSteps(2, 1, true))).toEqual(['A', 'C', 'B', 'D']);
    // Dropping a row next to itself does nothing.
    expect(dropSteps(2, 3, true)).toBe(0);
    expect(dropSteps(2, 1, false)).toBe(0);
  });

  it('finds a shape among its siblings, groups searched', () => {
    const shape = (id: number, children?: ShapeOutline[]) =>
      ({ id, children }) as ShapeOutline;
    const tree = [shape(2), shape(3, [shape(4), shape(5)]), shape(6)];
    expect(siblingsOf(tree, 5)?.index).toBe(1);
    expect(siblingsOf(tree, 5)?.siblings.map((s) => s.id)).toEqual([4, 5]);
    expect(siblingsOf(tree, 6)?.index).toBe(2);
    expect(siblingsOf(tree, 9)).toBeUndefined();
  });
});
