/**
 * Which layer a click selects, as in Figma.
 *
 * A hit test returns the chain of layers under the pointer, from the page's
 * child down to the deepest. Figma selects:
 *
 * - with ⌘/Ctrl held (deep select), the deepest layer;
 * - when something already selected is in the chain, or shares a parent
 *   with a layer in it, the layer at that same depth (so clicks move
 *   between siblings without climbing back out);
 * - otherwise the top-level layer, except that sections are transparent and
 *   a top-level frame (or component) selects its child directly.
 *
 * A double click selects one level deeper than the current selection.
 */

import type { LayerRow, NodeType } from '@core/fig-engine/types';

const TRANSPARENT: ReadonlySet<NodeType> = new Set(['SECTION']);
const CONTAINERS: ReadonlySet<NodeType> = new Set(['FRAME', 'SYMBOL']);

export interface SelectionContext {
  /** Selected ids with their parents' ids (`null` for page children). */
  selected: { id: string; parent: string | null }[];
}

/** Index in `chain` of the default target (no selection context). */
function defaultIndex(chain: LayerRow[]): number {
  let i = 0;
  while (i < chain.length - 1 && TRANSPARENT.has(chain[i].type)) i++;
  if (CONTAINERS.has(chain[i].type) && i + 1 < chain.length) return i + 1;
  return i;
}

export function clickTarget(
  chain: LayerRow[],
  context: SelectionContext,
  deep: boolean
): LayerRow | undefined {
  if (chain.length === 0) return undefined;
  if (deep) return chain[chain.length - 1];
  for (const s of context.selected) {
    const at = chain.findIndex((row) => row.id === s.id);
    if (at >= 0) return chain[at];
    // A sibling of the selection: same parent, so the same depth.
    if (s.parent === null) continue;
    const parentAt = chain.findIndex((row) => row.id === s.parent);
    if (parentAt >= 0 && parentAt + 1 < chain.length)
      return chain[parentAt + 1];
  }
  return chain[defaultIndex(chain)];
}

/** The layer a double click selects: one level below the selection. */
export function doubleClickTarget(
  chain: LayerRow[],
  context: SelectionContext
): LayerRow | undefined {
  if (chain.length === 0) return undefined;
  for (const s of context.selected) {
    const at = chain.findIndex((row) => row.id === s.id);
    if (at >= 0) return chain[Math.min(at + 1, chain.length - 1)];
  }
  const first = clickTarget(chain, context, false);
  const at = first ? chain.indexOf(first) : -1;
  return chain[Math.min(at + 1, chain.length - 1)];
}
