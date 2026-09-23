import {
  corners,
  enclosing,
  IDENTITY,
  intersects,
  inverse,
  type Matrix,
  multiply,
  transformPoint,
  translation,
} from './affine';
import {
  type Bounds,
  type GraphicsDocument,
  type GraphicsItem,
  type LegacyRectangle,
  type Point,
  rectangleDefinition,
} from './model';

export type SceneOverrides = Readonly<Record<string, GraphicsItem>>;
export function children(
  doc: GraphicsDocument,
  parentId = doc.rootId
): readonly string[] {
  return Object.values(doc.items)
    .filter((n) => n.type !== 'surface' && n.placement.parentId === parentId)
    .sort((a, b) =>
      a.type !== 'surface' && b.type !== 'surface'
        ? a.placement.order - b.placement.order ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        : 0
    )
    .map((n) => n.id);
}
export function paintOrder(doc: GraphicsDocument): readonly string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    for (const child of children(doc, id)) {
      result.push(child);
      visit(child);
    }
  };
  visit(doc.rootId);
  return result;
}
export const drawableIds = (doc: GraphicsDocument) =>
  paintOrder(doc).filter((id) => doc.items[id]?.type === 'rectangle');
export function worldMatrix(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
): Matrix {
  const node = Object.hasOwn(overrides, id) ? overrides[id] : doc.items[id];
  if (!node) throw new Error(`Missing node: ${id}`);
  return node.type === 'surface'
    ? IDENTITY
    : multiply(
        worldMatrix(doc, node.placement.parentId, overrides),
        node.transform
      );
}
export function nodeCorners(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
): readonly Point[] {
  const node = Object.hasOwn(overrides, id) ? overrides[id] : doc.items[id];
  if (!node) return [];
  if (node.type === 'rectangle')
    return corners(rectangleDefinition.bounds(node)).map((p) =>
      transformPoint(worldMatrix(doc, id, overrides), p)
    );
  return children(doc, id).flatMap((child) =>
    nodeCorners(doc, child, overrides)
  );
}
export const worldBounds = (
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
) => enclosing(nodeCorners(doc, id, overrides));
export function roots(
  doc: GraphicsDocument,
  ids: readonly string[]
): readonly string[] {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    let node = doc.items[id];
    if (!node || node.type === 'surface') return false;
    while (node && node.type !== 'surface') {
      if (selected.has(node.placement.parentId)) return false;
      node = doc.items[node.placement.parentId];
    }
    return true;
  });
}
export function outermost(doc: GraphicsDocument, id: string): string {
  let node = doc.items[id];
  while (
    node &&
    node.type !== 'surface' &&
    node.placement.parentId !== doc.rootId
  ) {
    id = node.placement.parentId;
    node = doc.items[id];
  }
  return id;
}
export function hitTest(
  doc: GraphicsDocument,
  point: Point,
  deep = false
): string | undefined {
  for (const id of [...drawableIds(doc)].reverse()) {
    const node = doc.items[id];
    if (
      node?.type === 'rectangle' &&
      rectangleDefinition.hitTest(
        node,
        transformPoint(inverse(worldMatrix(doc, id)), point)
      )
    )
      return deep ? id : outermost(doc, id);
  }
}
export function boxHits(doc: GraphicsDocument, box: Bounds): readonly string[] {
  return [
    ...new Set(
      drawableIds(doc)
        .filter((id) => intersects(nodeCorners(doc, id), corners(box)))
        .map((id) => outermost(doc, id))
    ),
  ];
}
export function freezeDocument(doc: GraphicsDocument): GraphicsDocument {
  if (doc.version !== 2 || doc.items[doc.rootId]?.type !== 'surface')
    throw new Error('Invalid scene root');
  const items: Record<string, GraphicsItem> = Object.create(null);
  for (const [id, node] of Object.entries(doc.items)) {
    if (id !== node.id) throw new Error('Node identity mismatch');
    if (node.type === 'surface') {
      if (id !== doc.rootId)
        throw new Error('Only one surface root per document is supported');
      Object.defineProperty(items, id, {
        value: Object.freeze({ ...node }),
        enumerable: true,
      });
      continue;
    }
    inverse(node.transform);
    if (!Number.isFinite(node.placement.order))
      throw new Error('Invalid sibling order');
    const parent = doc.items[node.placement.parentId];
    if (!parent || parent.type === 'rectangle')
      throw new Error('Invalid parent');
    const seen = new Set([id]);
    let ancestor: GraphicsItem | undefined = parent;
    while (ancestor && ancestor.type !== 'surface') {
      if (seen.has(ancestor.id)) throw new Error('Containment cycle');
      seen.add(ancestor.id);
      ancestor = doc.items[ancestor.placement.parentId];
    }
    if (ancestor?.id !== doc.rootId) throw new Error('Unreachable node');
    if (
      node.type === 'rectangle' &&
      ![node.geometry.width, node.geometry.height].every(
        (v) => Number.isFinite(v) && v > 0
      )
    )
      throw new Error('Invalid rectangle dimensions');
    const frozen = Object.freeze({
      ...node,
      placement: Object.freeze({ ...node.placement }),
      transform: Object.freeze([...node.transform]) as Matrix,
      ...(node.type === 'rectangle'
        ? {
            geometry: Object.freeze({ ...node.geometry }),
            appearance: Object.freeze({ ...node.appearance }),
          }
        : {}),
    });
    Object.defineProperty(items, id, { value: frozen, enumerable: true });
  }
  if (
    doc.surface &&
    ![doc.surface.width, doc.surface.height].every(
      (v) => Number.isFinite(v) && v > 0
    )
  )
    throw new Error('Invalid image dimensions');
  const result: GraphicsDocument = Object.freeze({
    ...doc,
    items: Object.freeze(items),
    ...(doc.surface ? { surface: Object.freeze({ ...doc.surface }) } : {}),
  });
  for (const id of Object.keys(items)) inverse(worldMatrix(result, id));
  return result;
}
export function createScene(
  seed: readonly (LegacyRectangle | GraphicsItem)[] = []
): GraphicsDocument {
  const rootId = 'scene-root';
  const items: Record<string, GraphicsItem> = {
    [rootId]: { id: rootId, type: 'surface' },
  };
  seed.forEach((node, index) => {
    if (Object.hasOwn(items, node.id)) throw new Error('Duplicate node ID');
    const next: GraphicsItem =
      node.type === 'rectangle' && !('transform' in node)
        ? {
            id: node.id,
            type: 'rectangle',
            placement: { parentId: rootId, order: index },
            transform: translation(node.geometry.x, node.geometry.y),
            geometry: {
              width: node.geometry.width,
              height: node.geometry.height,
            },
            appearance: node.appearance,
          }
        : node;
    Object.defineProperty(items, node.id, { value: next, enumerable: true });
  });
  return freezeDocument({ version: 2, rootId, items });
}
export function deleteSubtrees(
  doc: GraphicsDocument,
  ids: readonly string[]
): GraphicsDocument {
  const removed = new Set<string>();
  const visit = (id: string) => {
    removed.add(id);
    for (const child of children(doc, id)) visit(child);
  };
  for (const id of roots(doc, ids)) visit(id);
  return freezeDocument({
    ...doc,
    items: Object.fromEntries(
      Object.entries(doc.items).filter(([id]) => !removed.has(id))
    ),
  });
}
export function reparent(
  doc: GraphicsDocument,
  id: string,
  parentId: string,
  order: number
): GraphicsDocument {
  const node = doc.items[id];
  if (!node || node.type === 'surface')
    throw new Error('Cannot reparent root or missing node');
  const transform = multiply(
    inverse(worldMatrix(doc, parentId)),
    worldMatrix(doc, id)
  );
  return freezeDocument({
    ...doc,
    items: {
      ...doc.items,
      [id]: { ...node, placement: { parentId, order }, transform },
    },
  });
}
export function groupNodes(
  doc: GraphicsDocument,
  ids: readonly string[],
  id: string
): GraphicsDocument {
  const selected = roots(doc, ids),
    first = doc.items[selected[0] ?? ''];
  if (!first || first.type === 'surface' || Object.hasOwn(doc.items, id))
    throw new Error('Invalid group');
  const parentId = first.placement.parentId;
  if (
    selected.some((key) => {
      const n = doc.items[key];
      return !n || n.type === 'surface' || n.placement.parentId !== parentId;
    })
  )
    throw new Error('Group nodes must share a parent');
  const ordered = children(doc, parentId).filter((key) =>
    selected.includes(key)
  );
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    doc.items
  );
  items[id] = {
    id,
    type: 'group',
    placement: { parentId, order: first.placement.order },
    transform: IDENTITY,
  };
  ordered.forEach((key, index) => {
    const n = items[key];
    if (n && n.type !== 'surface')
      items[key] = { ...n, placement: { parentId: id, order: index } };
  });
  const order = Math.min(
    ...selected.map((key) => {
      const n = doc.items[key];
      return n && n.type !== 'surface' ? n.placement.order : 0;
    })
  );
  items[id] = { ...items[id], placement: { parentId, order } };
  return freezeDocument({ ...doc, items });
}
export function ungroupNode(
  doc: GraphicsDocument,
  id: string
): GraphicsDocument {
  const group = doc.items[id];
  if (group?.type !== 'group') throw new Error('Not a group');
  const parentId = group.placement.parentId;
  const order = children(doc, parentId).flatMap((key) =>
    key === id ? children(doc, id) : [key]
  );
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    doc.items
  );
  for (const child of children(doc, id)) {
    const node = items[child];
    if (node && node.type !== 'surface')
      items[child] = {
        ...node,
        placement: { parentId, order: 0 },
        transform: multiply(group.transform, node.transform),
      };
  }
  delete items[id];
  order.forEach((key, index) => {
    const n = items[key];
    if (n && n.type !== 'surface')
      items[key] = { ...n, placement: { parentId, order: index } };
  });
  return freezeDocument({ ...doc, items });
}
