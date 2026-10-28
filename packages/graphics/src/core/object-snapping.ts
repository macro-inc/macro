import {
  corners,
  enclosing,
  IDENTITY,
  type Matrix,
  multiply,
  transformPoint,
} from './affine';
import type { Bounds, GraphicsDocument, Point } from './model';
import { children } from './ordering';
import { isShape, shapeDefinition } from './shapes/registry';

export type SnapGuide = Readonly<{
  axis: 'x' | 'y';
  value: number;
  start: number;
  end: number;
}>;
export type ObjectSnapStats = Readonly<{
  targets: number;
  queries: number;
  candidates: number;
  visited: number;
}>;
type Anchor = { value: number; bounds: Bounds; id: string };
type RangeNode = {
  from: number;
  to: number;
  min: number;
  max: number;
  left?: RangeNode;
  right?: RangeNode;
};
type AxisIndex = { entries: Anchor[]; tree?: RangeNode };
type SnapIndex = { x: AxisIndex; y: AxisIndex; targets: number };

function indexAxis(entries: Anchor[], other: 'x' | 'y'): AxisIndex {
  const size = other === 'x' ? 'width' : 'height';
  entries.sort(
    (a, b) => a.value - b.value || a.bounds[other] - b.bounds[other]
  );
  function build(from: number, to: number): RangeNode {
    if (to - from === 1) {
      const bounds = entries[from]!.bounds;
      return {
        from,
        to,
        min: bounds[other],
        max: bounds[other] + bounds[size],
      };
    }
    const mid = (from + to) >>> 1;
    const left = build(from, mid),
      right = build(mid, to);
    return {
      from,
      to,
      min: Math.min(left.min, right.min),
      max: Math.max(left.max, right.max),
      left,
      right,
    };
  }
  return {
    entries,
    tree: entries.length ? build(0, entries.length) : undefined,
  };
}
const indexes = new WeakMap<GraphicsDocument['items'], SnapIndex>();
const positions = (start: number, size: number) => [
  start,
  start + size / 2,
  start + size,
];

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Build world bounds in one hierarchy traversal, then sort three anchors per axis.
 * Immutable document snapshots share the O(n log n) index across gestures. */
function indexScene(document: GraphicsDocument): SnapIndex {
  const cached = indexes.get(document.items);
  if (cached) return cached;
  const anchors: { x: Anchor[]; y: Anchor[]; targets: number } = {
    x: [],
    y: [],
    targets: 0,
  };
  function visit(id: string, parent: Matrix): Bounds | undefined {
    const item = document.items[id];
    if (!item || item.type === 'surface') return;
    const world = multiply(parent, item.transform);
    let bounds: Bounds | undefined;
    if (isShape(item)) {
      // Connector bindings move independently; their attachment snapping has its own policy.
      if (item.type === 'connector' || item.appearance.opacity === 0) return;
      const definition = shapeDefinition(item.type);
      bounds =
        definition.transformedBounds?.(item, world) ??
        enclosing(
          corners(definition.bounds(item)).map((p) => transformPoint(world, p))
        );
    } else {
      let complete = true;
      for (const child of children(document, id)) {
        const childBounds = visit(child, world);
        if (!childBounds) complete = false;
        else bounds = bounds ? union(bounds, childBounds) : childBounds;
      }
      // Do not advertise a group box that omits a connector or hidden child.
      if (!complete) return;
    }
    if (!bounds) return;
    anchors.targets++;
    for (const value of positions(bounds.x, bounds.width))
      anchors.x.push({ value, bounds, id });
    for (const value of positions(bounds.y, bounds.height))
      anchors.y.push({ value, bounds, id });
    return bounds;
  }
  for (const id of children(document)) visit(id, IDENTITY);
  const index: SnapIndex = {
    x: indexAxis(anchors.x, 'y'),
    y: indexAxis(anchors.y, 'x'),
    targets: anchors.targets,
  };
  if (Object.isFrozen(document.items)) indexes.set(document.items, index);
  return index;
}

/** Selection size does not multiply query work: query the combined moving box,
 * using a constant number of indexed alignment-band searches per update. The
 * orthogonal interval tree also prunes distant objects sharing a row/column. */
export function createObjectSnapper(
  document: GraphicsDocument,
  selection: readonly string[]
) {
  const index = indexScene(document);
  const excluded = new Set<string>();
  const descendants = (id: string) => {
    if (excluded.has(id)) return;
    excluded.add(id);
    for (const child of children(document, id)) descendants(child);
  };
  for (const id of selection) descendants(id);
  for (const id of selection) {
    let item = document.items[id];
    while (item && item.type !== 'surface') {
      const parent = item.placement.parentId;
      if (excluded.has(parent)) break;
      excluded.add(parent);
      item = document.items[parent];
    }
  }
  let queries = 0,
    candidates = 0,
    visited = 0;
  function find(
    axis: 'x' | 'y',
    anchors: readonly number[],
    bounds: Bounds,
    scale: number
  ) {
    const tolerance = 6 / scale,
      reach = 160 / scale;
    const other = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'height' : 'width';
    let best: { offset: number; anchor: Anchor; distance: number } | undefined;
    for (const value of anchors) {
      queries++;
      const { entries, tree } = index[axis];
      function visit(node: RangeNode | undefined) {
        if (!node) return;
        visited++;
        if (
          entries[node.from]!.value > value + tolerance ||
          entries[node.to - 1]!.value < value - tolerance ||
          node.min > bounds[other] + bounds[size] + reach ||
          node.max < bounds[other] - reach
        )
          return;
        if (node.left || node.right) {
          visit(node.left);
          visit(node.right);
          return;
        }
        const entry = entries[node.from]!;
        candidates++;
        if (excluded.has(entry.id)) return;
        const gap = Math.max(
          0,
          entry.bounds[other] - bounds[other] - bounds[size],
          bounds[other] - entry.bounds[other] - entry.bounds[size]
        );
        if (gap > reach) return;
        const offset = entry.value - value;
        if (
          !best ||
          Math.abs(offset) < Math.abs(best.offset) ||
          (Math.abs(offset) === Math.abs(best.offset) && gap < best.distance)
        )
          best = { offset, anchor: entry, distance: gap };
      }
      visit(tree);
    }
    return best;
  }
  return {
    stats: (): ObjectSnapStats => ({
      targets: index.targets,
      queries,
      candidates,
      visited,
    }),
    snap(
      bounds: Bounds,
      scale: number,
      anchors = {
        x: positions(bounds.x, bounds.width),
        y: positions(bounds.y, bounds.height),
      }
    ) {
      const x = find('x', anchors.x, bounds, scale),
        y = find('y', anchors.y, bounds, scale);
      const offset: Point = { x: x?.offset ?? 0, y: y?.offset ?? 0 };
      const guides: SnapGuide[] = [];
      for (const [axis, match] of [
        ['x', x],
        ['y', y],
      ] as const) {
        if (!match) continue;
        const other = axis === 'x' ? 'y' : 'x',
          size = axis === 'x' ? 'height' : 'width';
        guides.push({
          axis,
          value: match.anchor.value,
          start:
            Math.min(
              bounds[other] + offset[other],
              match.anchor.bounds[other]
            ) -
            8 / scale,
          end:
            Math.max(
              bounds[other] + offset[other] + bounds[size],
              match.anchor.bounds[other] + match.anchor.bounds[size]
            ) +
            8 / scale,
        });
      }
      return { offset, guides };
    },
  };
}
export type ObjectSnapper = ReturnType<typeof createObjectSnapper>;
