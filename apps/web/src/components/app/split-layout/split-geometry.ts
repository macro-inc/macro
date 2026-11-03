import type {
  PaneId,
  PaneLayout,
  SplitAxis,
  SplitPath,
  SplitSide,
} from '@app/lib/split-router';
import { computeFractionalShares } from '@core/component/Resize/solver';
import type { Panel } from '@core/component/Resize/types';
import {
  DEFAULT_SPLIT_MIN_HEIGHT,
  DEFAULT_SPLIT_MIN_WIDTH,
} from './splitContentSizing';

export type Size = { width: number; height: number };

export type Rect = Size & { left: number; top: number };

/** Where the splits tile, as the layout measured it, and the gap between them. */
export type TileArea = Size & { gutter: number };

/** One split as laid out: what dragging one of its gutters needs. */
export type SolvedSplit = {
  path: SplitPath;
  axis: SplitAxis;
  rect: Rect;
  /** Rendered shares, which can differ from the intended ones when space is short. */
  shares: readonly number[];
  /** Each child's minimum along the axis. */
  minimums: readonly number[];
  /** Where each gutter starts along the axis, within `rect`. */
  gutters: readonly number[];
};

export type TileGeometry = {
  panes: ReadonlyMap<PaneId, Rect>;
  splits: readonly SolvedSplit[];
};

const MIN_PANE_SIZE: Size = {
  width: DEFAULT_SPLIT_MIN_WIDTH,
  height: DEFAULT_SPLIT_MIN_HEIGHT,
};

const lengthAlong = (axis: SplitAxis, size: Size) =>
  axis === 'row' ? size.width : size.height;

/** The smallest size of `sizes` laid out along `axis`. */
function joinedSize(
  axis: SplitAxis,
  sizes: readonly Size[],
  gutter: number
): Size {
  const gutters = gutter * Math.max(0, sizes.length - 1);
  const widths = sizes.map((size) => size.width);
  const heights = sizes.map((size) => size.height);
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0);

  if (axis === 'row') {
    return { width: sum(widths) + gutters, height: Math.max(...heights) };
  }

  return { width: Math.max(...widths), height: sum(heights) + gutters };
}

/**
 * The smallest size `layout` fits in with every split at its minimum, with
 * `grown` split in two along `axis` when given.
 */
function minimumSize(
  layout: PaneLayout,
  gutter: number,
  grown?: { pane: PaneId; axis: SplitAxis }
): Size {
  if (layout.type === 'pane') {
    if (grown?.pane !== layout.pane) return MIN_PANE_SIZE;

    return joinedSize(grown.axis, [MIN_PANE_SIZE, MIN_PANE_SIZE], gutter);
  }

  const sizes = layout.children.map((child) =>
    minimumSize(child, gutter, grown)
  );

  return joinedSize(layout.axis, sizes, gutter);
}

/** Whether a new full-height split fits beside the others. */
export function fitsNewColumn(
  layout: PaneLayout | undefined,
  area: TileArea
): boolean {
  if (!layout) return true;

  const current = minimumSize(layout, area.gutter);
  const grown = joinedSize('row', [current, MIN_PANE_SIZE], area.gutter);

  return grown.width <= area.width;
}

/** Whether splitting `pane` toward `side` leaves every split its minimum along that axis. */
export function fitsSplit(
  layout: PaneLayout | undefined,
  area: TileArea,
  pane: PaneId,
  side: SplitSide
): boolean {
  if (!layout) return true;

  const axis: SplitAxis =
    side === 'left' || side === 'right' ? 'row' : 'column';
  const grown = minimumSize(layout, area.gutter, { pane, axis });

  return lengthAlong(axis, grown) <= lengthAlong(axis, area);
}

/** Lays `layout` out in `area`: a rect for each pane and the gutters of each split. */
export function solveTiles(
  layout: PaneLayout | undefined,
  area: TileArea
): TileGeometry {
  const panes = new Map<PaneId, Rect>();
  const splits: SolvedSplit[] = [];
  const { gutter } = area;

  const place = (node: PaneLayout, rect: Rect, path: SplitPath) => {
    if (node.type === 'pane') {
      panes.set(node.pane, rect);
      return;
    }

    const minimums = node.children.map((child) =>
      lengthAlong(node.axis, minimumSize(child, gutter))
    );
    const panels: Panel[] = node.children.map((_, index) => ({
      id: String(index),
      minSize: minimums[index]!,
      maxSize: Infinity,
      share: node.shares[index]!,
      target: { kind: 'auto' },
    }));
    const solved = computeFractionalShares(
      panels,
      lengthAlong(node.axis, rect),
      gutter
    );

    const offsets = panels.map(({ id }) => solved.offsets.get(id) ?? 0);
    const sizes = panels.map(({ id }) => solved.sizes.get(id) ?? 0);

    splits.push({
      path,
      axis: node.axis,
      rect,
      shares: panels.map(({ id }) => solved.shares.get(id) ?? 0),
      minimums,
      gutters: offsets
        .slice(0, -1)
        .map((offset, index) => offset + sizes[index]!),
    });

    node.children.forEach((child, index) => {
      const offset = offsets[index]!;
      const size = sizes[index]!;
      const childRect: Rect =
        node.axis === 'row'
          ? { ...rect, left: rect.left + offset, width: size }
          : { ...rect, top: rect.top + offset, height: size };

      place(child, childRect, [...path, index]);
    });
  };

  if (layout) {
    place(
      layout,
      { left: 0, top: 0, width: area.width, height: area.height },
      []
    );
  }

  return { panes, splits };
}
