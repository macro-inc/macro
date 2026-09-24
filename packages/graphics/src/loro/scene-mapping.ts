import type { LoroTree, LoroTreeNode } from 'loro-crdt';
import {
  IDENTITY,
  inverse,
  type Matrix,
  multiply,
  sameMatrix,
} from '../core/affine';
import { resolveAppearance } from '../core/appearance';
import type { GraphicsDocument, GraphicsItem, ShapeKind } from '../core/model';
import { sortKeysBetween } from '../core/ordering';
import {
  children,
  freezeDocument,
  paintOrder,
  roots,
  worldMatrix,
} from '../core/scene';
import { isShape } from '../core/shapes/registry';

/** Experimental merge unit: geometry and its coordinate frame always win together. */
export type NodeData = {
  id: string;
  kind: ShapeKind | 'group';
  pose: {
    parentId: string;
    transform: Matrix;
    world: Matrix;
    geometry: { width: number; height: number } | null;
  };
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius: number;
};

export function readScene(tree: LoroTree<NodeData>, rootId: string) {
  const items: Record<string, GraphicsItem> = {
    [rootId]: { id: rootId, type: 'surface' },
  };
  const frameConflicts: string[] = [];
  function visit(
    nodes: LoroTreeNode<NodeData>[],
    parentId: string,
    parentWorld: Matrix
  ) {
    // Loro owns durable ordering. These keys are a disposable core projection.
    const keys = sortKeysBetween(null, null, nodes.length);
    nodes.forEach((node, index) => {
      const id = node.data.get('id'),
        kind = node.data.get('kind'),
        pose = node.data.get('pose');
      if (!id || !kind || !pose || Object.hasOwn(items, id))
        throw new Error('Invalid shared scene node');
      const matchingFrame = pose.parentId === parentId;
      const transform = matchingFrame
        ? pose.transform
        : multiply(inverse(parentWorld), pose.world);
      if (!matchingFrame) frameConflicts.push(id);
      const spatial = {
        id,
        transform,
        placement: { parentId, sortKey: keys[index]! },
      };
      if (kind === 'group') items[id] = { ...spatial, type: 'group' };
      else {
        const fill = node.data.get('fill'),
          stroke = node.data.get('stroke');
        if (!pose.geometry || fill === undefined || stroke === undefined)
          throw new Error('Invalid shared shape');
        items[id] = {
          ...spatial,
          type: kind,
          geometry: pose.geometry,
          appearance: {
            fill,
            stroke,
            strokeWidth: node.data.get('strokeWidth') ?? 2,
            opacity: node.data.get('opacity') ?? 1,
            cornerRadius: node.data.get('cornerRadius') ?? 0,
          },
        };
      }
      visit(node.children() ?? [], id, multiply(parentWorld, transform));
    });
  }
  visit(tree.roots() as LoroTreeNode<NodeData>[], rootId, IDENTITY);
  return { document: freezeDocument({ rootId, items }), frameConflicts };
}

function writeNodeData(
  handle: LoroTreeNode<NodeData>,
  node: Exclude<GraphicsItem, { type: 'surface' }>,
  old: GraphicsItem | undefined,
  next: GraphicsDocument,
  parentChanged: boolean
) {
  const geometry = isShape(node) ? node.geometry : null;
  const oldGeometry = isShape(old) ? old.geometry : null;
  if (
    !old ||
    old.type === 'surface' ||
    parentChanged ||
    !sameMatrix(old.transform, node.transform) ||
    JSON.stringify(geometry) !== JSON.stringify(oldGeometry)
  ) {
    handle.data.set('pose', {
      parentId: node.placement.parentId,
      transform: node.transform,
      world: worldMatrix(next, node.id),
      geometry,
    });
  }
  if (isShape(node)) {
    const appearance = resolveAppearance(node.appearance);
    const previous = isShape(old)
      ? resolveAppearance(old.appearance)
      : undefined;
    for (const key of ['strokeWidth', 'opacity', 'cornerRadius'] as const) {
      if (!previous || previous[key] !== appearance[key])
        handle.data.set(key, appearance[key]);
    }
    if (!isShape(old) || old.appearance.fill !== node.appearance.fill)
      handle.data.set('fill', node.appearance.fill);
    if (!isShape(old) || old.appearance.stroke !== node.appearance.stroke)
      handle.data.set('stroke', node.appearance.stroke);
  }
}

/** Diff a validated proposal; never replace whole nodes or write unchanged fields. */
export function writeScene(
  tree: LoroTree<NodeData>,
  before: GraphicsDocument,
  next: GraphicsDocument
) {
  if (before.rootId !== next.rootId || next.surface)
    throw new Error('Shared playground supports one unbounded surface');
  const handles = new Map(
    tree.getNodes().map((node) => [node.data.get('id'), node])
  );
  const order = paintOrder(next);
  const reposition = new Set<string>();
  const reparent = new Set<string>();
  // Reject unsupported proposals before producing any CRDT operations.
  for (const id of order) {
    if (before.items[id] && before.items[id]!.type !== next.items[id]!.type)
      throw new Error('Shared node kinds are immutable');
  }
  for (const id of order) {
    const node = next.items[id]!,
      old = before.items[id];
    if (node.type === 'surface') continue;
    let handle = handles.get(id);
    if (!handle) {
      handle = tree.createNode();
      handle.data.set('id', id);
      handle.data.set('kind', node.type);
      handles.set(id, handle);
    }
    if (
      !old ||
      old.type === 'surface' ||
      old.placement.parentId !== node.placement.parentId
    ) {
      reparent.add(id);
      reposition.add(id);
    } else if (old.placement.sortKey !== node.placement.sortKey)
      reposition.add(id);
    writeNodeData(handle, node, old, next, reparent.has(id));
  }
  // Lift first so a valid final hierarchy cannot hit an intermediate local cycle.
  for (const id of reparent) handles.get(id)!.move();
  for (const id of order) {
    if (!reparent.has(id)) continue;
    const node = next.items[id]!;
    if (node.type !== 'surface')
      handles.get(id)!.move(handles.get(node.placement.parentId));
  }
  const removed = Object.keys(before.items).filter((id) => !next.items[id]);
  for (const id of roots(before, removed)) {
    const handle = handles.get(id);
    if (handle) tree.delete(handle.id);
  }
  for (const parent of [next.rootId, ...order]) {
    const siblings = children(next, parent);
    for (let i = siblings.length - 1; i >= 0; i--) {
      const id = siblings[i]!;
      if (!reposition.has(id)) continue;
      const handle = handles.get(id)!;
      const after = siblings[i + 1];
      if (after) handle.moveBefore(handles.get(after)!);
      else handle.move(handles.get(parent));
    }
  }
}
