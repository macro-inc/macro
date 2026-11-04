import type { PaneId } from './types';

/** Children side by side (`row`) or stacked (`column`). */
export type SplitAxis = 'row' | 'column';

/** Where a new pane goes beside the pane it splits. */
export type SplitSide = 'left' | 'right' | 'above' | 'below';

/**
 * How the open panes tile. A split has at least two children, never a child
 * split along its own axis, and shares that sum to 1. Its panes in depth-first
 * order are the open panes in order.
 */
export type PaneLayout =
  | { readonly type: 'pane'; readonly pane: PaneId }
  | {
      readonly type: 'split';
      readonly axis: SplitAxis;
      readonly children: readonly PaneLayout[];
      /** Each child's fraction of the split's length along its axis. */
      readonly shares: readonly number[];
    };

/** A layout's structure without its panes or sizes, as a URL records it. */
export type LayoutShape =
  | 'pane'
  | { readonly axis: SplitAxis; readonly children: readonly LayoutShape[] };

/** Child indexes from the root down to a split. */
export type SplitPath = readonly number[];

type Part = { node: PaneLayout; share: number };

const paneNode = (pane: PaneId): PaneLayout => ({ type: 'pane', pane });

function partsOf(layout: PaneLayout & { type: 'split' }): Part[] {
  return layout.children.map((node, index) => ({
    node,
    share: layout.shares[index]!,
  }));
}

/**
 * The split of `parts` along `axis`, merging child splits along the same axis
 * into it and collapsing to the only child when one is left.
 */
function joined(
  axis: SplitAxis,
  parts: readonly Part[]
): PaneLayout | undefined {
  const flat = parts.flatMap(({ node, share }): Part[] => {
    if (node.type === 'split' && node.axis === axis) {
      return partsOf(node).map((child) => ({
        node: child.node,
        share: share * child.share,
      }));
    }

    return [{ node, share }];
  });

  if (flat.length === 0) return;
  if (flat.length === 1) return flat[0]!.node;

  const total = flat.reduce((sum, part) => sum + part.share, 0);
  const valid = total > 0 && Number.isFinite(total);

  return {
    type: 'split',
    axis,
    children: flat.map((part) => part.node),
    shares: flat.map((part) => (valid ? part.share / total : 1 / flat.length)),
  };
}

export function paneIds(layout: PaneLayout | undefined): PaneId[] {
  if (!layout) return [];
  if (layout.type === 'pane') return [layout.pane];

  return layout.children.flatMap(paneIds);
}

/** `panes` side by side in equal shares: the layout of a URL without one. */
export function rowLayout(panes: readonly PaneId[]): PaneLayout | undefined {
  return joined(
    'row',
    panes.map((pane) => ({ node: paneNode(pane), share: 1 }))
  );
}

const axisOf = (side: SplitSide): SplitAxis =>
  side === 'left' || side === 'right' ? 'row' : 'column';

/** `layout` with `pane` replaced by what `replace` returns, normalized. */
function replacePane(
  layout: PaneLayout,
  pane: PaneId,
  replace: (node: PaneLayout) => PaneLayout | undefined
): PaneLayout | undefined {
  if (layout.type === 'pane') {
    return layout.pane === pane ? replace(layout) : layout;
  }

  const parts = partsOf(layout).flatMap((part): Part[] => {
    const node = replacePane(part.node, pane, replace);

    return node ? [{ node, share: part.share }] : [];
  });

  return joined(layout.axis, parts);
}

/**
 * Puts `pane` on `side` of `target`. Within a split along that axis it joins
 * as a sibling with an equal share, the others scaling down to make room;
 * otherwise `target` becomes a split of the two, halved.
 */
export function splitPane(
  layout: PaneLayout,
  target: PaneId,
  pane: PaneId,
  side: SplitSide
): PaneLayout {
  const axis = axisOf(side);
  const before = side === 'left' || side === 'above';
  const added = paneNode(pane);

  const place = (node: PaneLayout): PaneLayout => {
    if (node.type === 'pane') {
      if (node.pane !== target) return node;

      const children = before ? [added, node] : [node, added];

      return { type: 'split', axis, children, shares: [0.5, 0.5] };
    }

    const at = node.children.findIndex(
      (child) => child.type === 'pane' && child.pane === target
    );
    if (at < 0 || node.axis !== axis) {
      return { ...node, children: node.children.map(place) };
    }

    const incoming = 1 / (node.children.length + 1);
    const parts = partsOf(node).map((part) => ({
      node: part.node,
      share: part.share * (1 - incoming),
    }));
    parts.splice(before ? at : at + 1, 0, { node: added, share: incoming });

    return joined(axis, parts)!;
  };

  return place(layout);
}

/**
 * Adds `pane` as a full-height column after the column holding `after`, or
 * first without one. The others scale down to make its equal share of room.
 */
export function insertColumn(
  layout: PaneLayout | undefined,
  pane: PaneId,
  after: PaneId | undefined
): PaneLayout {
  if (!layout) return paneNode(pane);

  const columns =
    layout.type === 'split' && layout.axis === 'row'
      ? partsOf(layout)
      : [{ node: layout, share: 1 }];
  const at =
    columns.findIndex(
      ({ node }) => after !== undefined && paneIds(node).includes(after)
    ) + 1;

  const incoming = 1 / (columns.length + 1);
  const parts = columns.map((part) => ({
    node: part.node,
    share: part.share * (1 - incoming),
  }));
  parts.splice(at, 0, { node: paneNode(pane), share: incoming });

  return joined('row', parts)!;
}

/** `layout` without `pane`; its space goes to the rest of its split. */
export function removePane(
  layout: PaneLayout | undefined,
  pane: PaneId
): PaneLayout | undefined {
  if (!layout) return;

  return replacePane(layout, pane, () => undefined);
}

/** `layout` without the panes `drop` picks, collapsing splits as `removePane` does. */
export function withoutPanes(
  layout: PaneLayout | undefined,
  drop: (pane: PaneId) => boolean
): PaneLayout | undefined {
  return paneIds(layout)
    .filter(drop)
    .reduce<PaneLayout | undefined>(
      (tiles, pane) => removePane(tiles, pane),
      layout
    );
}

/**
 * How `panes` tile within `layout` once its other panes are gone; undefined
 * unless `layout` holds every one of them, in this order.
 */
export function tilesFor(
  layout: PaneLayout | undefined,
  panes: readonly PaneId[]
): PaneLayout | undefined {
  const tiles = withoutPanes(layout, (pane) => !panes.includes(pane));
  const order = paneIds(tiles);
  const inOrder =
    order.length === panes.length &&
    order.every((pane, index) => pane === panes[index]);

  return inOrder ? tiles : undefined;
}

/** The same tiles and sizes showing `panes`, in order, instead. */
export function reorderPanes(
  layout: PaneLayout | undefined,
  panes: readonly PaneId[]
): PaneLayout | undefined {
  if (!layout) return;

  let next = 0;
  const fill = (node: PaneLayout): PaneLayout => {
    if (node.type === 'pane') return paneNode(panes[next++]!);

    return { ...node, children: node.children.map(fill) };
  };

  return fill(layout);
}

export function splitAt(
  layout: PaneLayout | undefined,
  path: SplitPath
): (PaneLayout & { type: 'split' }) | undefined {
  let node = layout;
  for (const index of path) {
    if (node?.type !== 'split') return;
    node = node.children[index];
  }

  return node?.type === 'split' ? node : undefined;
}

/** `layout` with the split at `path` divided by `shares`. */
export function resizeSplit(
  layout: PaneLayout | undefined,
  path: SplitPath,
  shares: readonly number[]
): PaneLayout | undefined {
  if (!layout) return;

  const resize = (node: PaneLayout, depth: number): PaneLayout => {
    if (node.type !== 'split') return node;
    if (depth === path.length) {
      if (shares.length !== node.children.length) return node;

      return { ...node, shares };
    }

    const index = path[depth]!;
    const child = node.children[index];
    if (!child) return node;

    return {
      ...node,
      children: node.children.with(index, resize(child, depth + 1)),
    };
  };

  return resize(layout, 0);
}

/** `layout` with every split divided equally. */
export function resetShares(
  layout: PaneLayout | undefined
): PaneLayout | undefined {
  if (layout?.type !== 'split') return layout;

  return {
    ...layout,
    children: layout.children.map((child) => resetShares(child)!),
    shares: layout.children.map(() => 1 / layout.children.length),
  };
}

/** `next`, keeping the sizes of `current`'s splits wherever the two match. */
export function withSharesFrom(
  next: PaneLayout | undefined,
  current: PaneLayout | undefined
): PaneLayout | undefined {
  if (next?.type !== 'split' || current?.type !== 'split') return next;

  const sameSplit =
    next.axis === current.axis &&
    next.children.length === current.children.length;
  if (!sameSplit) return next;

  return {
    ...next,
    children: next.children.map(
      (child, index) => withSharesFrom(child, current.children[index])!
    ),
    shares: current.shares,
  };
}

export function layoutShape(layout: PaneLayout): LayoutShape {
  if (layout.type === 'pane') return 'pane';

  return { axis: layout.axis, children: layout.children.map(layoutShape) };
}

function shapePaneCount(shape: LayoutShape): number {
  if (shape === 'pane') return 1;

  return shape.children.reduce(
    (count, child) => count + shapePaneCount(child),
    0
  );
}

/** `shape` showing `panes` in equal shares; undefined unless the counts match. */
export function fillShape(
  shape: LayoutShape,
  panes: readonly PaneId[]
): PaneLayout | undefined {
  if (shapePaneCount(shape) !== panes.length) return;

  let next = 0;
  const fill = (node: LayoutShape): PaneLayout => {
    if (node === 'pane') return paneNode(panes[next++]!);

    return {
      type: 'split',
      axis: node.axis,
      children: node.children.map(fill),
      shares: node.children.map(() => 1 / node.children.length),
    };
  };

  return fill(shape);
}

/** Whether any panes are stacked, which a plain list of panes can't record. */
export function hasColumns(shape: LayoutShape): boolean {
  if (shape === 'pane') return false;
  if (shape.axis === 'column') return true;

  return shape.children.some(hasColumns);
}
