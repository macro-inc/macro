/**
 * Selecting several slides (in the rail and the slide sorter) and moving
 * them together, as PowerPoint does.
 */

import type { EditOp } from '@core/pptx-engine/types';

export interface SlideSelection {
  /** Selected slide ids, in deck order. */
  ids: number[];
  /** Where a Shift-click range starts. */
  anchor: number;
}

/**
 * The selection after clicking slide `id`: a plain click selects it alone,
 * Cmd/Ctrl toggles it, and Shift selects the range from the anchor.
 */
export function clickSlide(
  order: number[],
  current: SlideSelection,
  id: number,
  mods: { shift: boolean; toggle: boolean }
): SlideSelection {
  const inOrder = (ids: Iterable<number>) => {
    const set = new Set(ids);
    return order.filter((x) => set.has(x));
  };
  if (mods.shift) {
    const a = order.indexOf(current.anchor);
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return { ids: [id], anchor: id };
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return {
      ids: mods.toggle ? inOrder([...current.ids, ...range]) : range,
      anchor: current.anchor,
    };
  }
  if (mods.toggle) {
    const has = current.ids.includes(id);
    const ids = has
      ? current.ids.filter((x) => x !== id)
      : inOrder([...current.ids, id]);
    // The last slide stays selected.
    return ids.length > 0 ? { ids, anchor: id } : current;
  }
  return { ids: [id], anchor: id };
}

/**
 * Operations that move `moving` (kept in deck order) so the block lands
 * before the slide now at `at` (`order.length` = the end).
 */
export function moveSlidesOps(
  order: number[],
  moving: number[],
  at: number
): EditOp[] {
  const block = order.filter((id) => moving.includes(id));
  const rest = order.filter((id) => !moving.includes(id));
  const before = order.slice(0, at).filter((id) => !moving.includes(id));
  const target = [
    ...rest.slice(0, before.length),
    ...block,
    ...rest.slice(before.length),
  ];
  // Place each slide of the final order in turn.
  const now = [...order];
  const ops: EditOp[] = [];
  target.forEach((id, to) => {
    const from = now.indexOf(id);
    if (from === to) return;
    now.splice(from, 1);
    now.splice(to, 0, id);
    ops.push({ op: 'moveSlide', slide: id, to });
  });
  return ops;
}
