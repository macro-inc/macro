import { enclosing, inverse, multiply, translation } from './affine';
import { resolveAppearance } from './appearance';
import {
  duplicateNodes,
  type GraphicsFragment,
  type IdFactory,
  pasteFragment,
} from './fragments';
import { layoutBounds, layoutRoots } from './layout';
import type { Appearance, GraphicsDocument, Point } from './model';
import { children, nodeBoundsPoints, roots, worldMatrix } from './scene';
import { isShape } from './shapes/registry';
import { snapTranslation } from './snapping';
import { selectedShapeIds } from './style-selection';

export type CommandContext = Readonly<{
  document: GraphicsDocument;
  selection: readonly string[];
  snapUnit?: number;
}>;
export type CommandResult = Readonly<{
  document: GraphicsDocument;
  selection?: readonly string[];
}>;
/** Typed, pure contribution; the editor owns validation, notification and history. */
export type GraphicsCommand<Payload> = Readonly<{
  id: string;
  apply(context: CommandContext, payload: Payload): CommandResult;
}>;
function move(
  document: GraphicsDocument,
  offsets: ReadonlyMap<string, Point>
): GraphicsDocument {
  const items = { ...document.items };
  let changed = false;
  for (const [id, delta] of offsets) {
    if (![delta.x, delta.y].every(Number.isFinite))
      throw new Error('Invalid translation');
    if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) continue;
    const node = items[id];
    if (!node || node.type === 'surface') continue;
    items[id] = {
      ...node,
      transform: multiply(
        inverse(worldMatrix(document, node.placement.parentId)),
        multiply(translation(delta.x, delta.y), worldMatrix(document, id))
      ),
    };
    changed = true;
  }
  return changed ? { ...document, items } : document;
}
export const selectAllCommand: GraphicsCommand<void> = {
  id: 'select-all',
  apply: ({ document }) => ({ document, selection: children(document) }),
};
export const nudgeCommand: GraphicsCommand<Point> = {
  id: 'nudge',
  apply: ({ document, selection, snapUnit }, delta) => {
    const selected = roots(document, selection);
    const bounds = enclosing(
      selected.flatMap((id) => nodeBoundsPoints(document, id))
    );
    const snapped = snapTranslation(bounds, delta, snapUnit);
    return {
      document: move(document, new Map(selected.map((id) => [id, snapped]))),
    };
  },
};
export const duplicateCommand: GraphicsCommand<{
  createId: IdFactory;
  offset?: Point;
}> = {
  id: 'duplicate',
  apply: (
    { document, selection, snapUnit },
    { createId, offset = { x: 24, y: 24 } }
  ) => {
    const bounds = enclosing(
      roots(document, selection).flatMap((id) => nodeBoundsPoints(document, id))
    );
    return duplicateNodes(
      document,
      selection,
      createId,
      snapTranslation(bounds, offset, snapUnit)
    );
  },
};
export const pasteCommand: GraphicsCommand<{
  fragment: GraphicsFragment;
  createId: IdFactory;
  offset?: Point;
}> = {
  id: 'paste',
  apply: (
    { document, snapUnit },
    { fragment, createId, offset = { x: 24, y: 24 } }
  ) => {
    const bounds = enclosing(
      children(fragment.scene).flatMap((id) =>
        nodeBoundsPoints(fragment.scene, id)
      )
    );
    return pasteFragment(
      document,
      fragment,
      createId,
      snapTranslation(bounds, offset, snapUnit)
    );
  },
};
export const styleCommand: GraphicsCommand<Partial<Appearance>> = {
  id: 'style',
  apply: ({ document, selection }, patch) => {
    const items = { ...document.items };
    let changed = false;
    for (const id of selectedShapeIds(document, selection)) {
      const node = items[id];
      if (!isShape(node)) continue;
      const before = resolveAppearance(node.appearance);
      const after = resolveAppearance({ ...node.appearance, ...patch });
      if (
        Object.keys(after).every(
          (key) =>
            before[key as keyof typeof before] ===
            after[key as keyof typeof after]
        )
      )
        continue;
      items[id] = { ...node, appearance: after };
      changed = true;
    }
    return { document: changed ? { ...document, items } : document };
  },
};
export type Alignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';
export const alignCommand: GraphicsCommand<Alignment> = {
  id: 'align',
  apply: ({ document, selection }, alignment) => {
    const ids = layoutRoots(document, selection);
    if (ids.length < 2) return { document };
    const all = enclosing(
      ids.flatMap((id) => {
        const b = layoutBounds(document, id);
        return [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
        ];
      })
    );
    const offsets = new Map(
      ids.map((id) => {
        const b = layoutBounds(document, id);
        const deltas: Record<Alignment, Point> = {
          left: { x: all.x - b.x, y: 0 },
          center: { x: all.x + all.width / 2 - b.x - b.width / 2, y: 0 },
          right: { x: all.x + all.width - b.x - b.width, y: 0 },
          top: { x: 0, y: all.y - b.y },
          middle: { x: 0, y: all.y + all.height / 2 - b.y - b.height / 2 },
          bottom: { x: 0, y: all.y + all.height - b.y - b.height },
        };
        return [id, deltas[alignment]] as const;
      })
    );
    return { document: move(document, offsets) };
  },
};
/** Equal gaps between world bounds, keeping the two outer items fixed. */
export const distributeCommand: GraphicsCommand<'horizontal' | 'vertical'> = {
  id: 'distribute',
  apply: ({ document, selection }, axis) => {
    const horizontal = axis === 'horizontal';
    const entries = layoutRoots(document, selection).map((id) => ({
      id,
      b: layoutBounds(document, id),
    }));
    const start = (b: (typeof entries)[number]['b']) =>
      horizontal ? b.x : b.y;
    const size = (b: (typeof entries)[number]['b']) =>
      horizontal ? b.width : b.height;
    entries.sort((a, b) => start(a.b) - start(b.b) || a.id.localeCompare(b.id));
    if (entries.length < 3) return { document };
    const first = entries[0]!.b,
      last = entries[entries.length - 1]!.b;
    const gap =
      (start(last) +
        size(last) -
        start(first) -
        entries.reduce((n, e) => n + size(e.b), 0)) /
      (entries.length - 1);
    let position = start(first);
    const offsets = new Map<string, Point>();
    for (const entry of entries) {
      const delta = position - start(entry.b);
      offsets.set(
        entry.id,
        horizontal ? { x: delta, y: 0 } : { x: 0, y: delta }
      );
      position += size(entry.b) + gap;
    }
    return { document: move(document, offsets) };
  },
};
