import {
  corners,
  enclosing,
  IDENTITY,
  inverse,
  type Matrix,
  multiply,
  transformPoint,
} from './affine';
import { resolveAppearance, validAppearance } from './appearance';
import {
  connectorWorldView,
  resolveConnector,
  retainConnectorBindings,
} from './connectors';
import type {
  Bounds,
  GraphicsDocument,
  GraphicsItem,
  Point,
  ShapeKind,
} from './model';
import {
  children,
  insertionIndex,
  isSortKey,
  keysAt,
  type LayerPosition,
} from './ordering';
import { isShape, shapeDefinition } from './shapes/registry';

export type SceneOverrides = Readonly<Record<string, GraphicsItem>>;
export { children } from './ordering';

const paintOrders = new WeakMap<GraphicsDocument['items'], readonly string[]>();
export function paintOrder(doc: GraphicsDocument): readonly string[] {
  const cached = paintOrders.get(doc.items);
  if (cached) return cached;
  const result: string[] = [];
  const visit = (id: string) => {
    for (const child of children(doc, id)) {
      result.push(child);
      if (!isShape(doc.items[child])) visit(child);
    }
  };
  visit(doc.rootId);
  // Bound connectors cannot be obscured by either endpoint, even when those
  // endpoints live in different groups or have just been reordered.
  const positions = new Map(result.map((id, index) => [id, index]));
  const above = new Map<number, string[]>();
  const deferred = new Set<string>();
  result.forEach((id, index) => {
    const item = doc.items[id];
    if (item?.type !== 'connector') return;
    const targets = [
      item.geometry.start.binding,
      item.geometry.end.binding,
    ].flatMap((binding) =>
      binding && isShape(doc.items[binding.targetId])
        ? [positions.get(binding.targetId)!]
        : []
    );
    if (!targets.length) return;
    const rank = Math.max(index, ...targets);
    const bucket = above.get(rank) ?? [];
    bucket.push(id);
    above.set(rank, bucket);
    deferred.add(id);
  });
  const ordered = deferred.size
    ? result.flatMap((id, index) => [
        ...(deferred.has(id) ? [] : [id]),
        ...(above.get(index) ?? []),
      ])
    : result;
  Object.freeze(ordered);
  if (Object.isFrozen(doc.items)) paintOrders.set(doc.items, ordered);
  return ordered;
}
export const drawableIds = (doc: GraphicsDocument) =>
  paintOrder(doc).filter((id) => isShape(doc.items[id]));
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
/** Geometry projection for scene-dependent features such as bound connectors. */
export function resolvedShape(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
) {
  const node = overrides[id] ?? doc.items[id];
  if (!isShape(node)) return;
  return node.type === 'connector'
    ? resolveConnector(doc, node, overrides)
    : node;
}
/** Geometry and frame shared by drawing, selection bounds, and picking. */
export function shapeProjection(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
) {
  const item = resolvedShape(doc, id, overrides);
  const transform = worldMatrix(doc, id, overrides);
  if (
    item?.type === 'connector' &&
    (item.geometry.start.binding || item.geometry.end.binding)
  ) {
    return { item: connectorWorldView(item, transform), transform: IDENTITY };
  }
  return { item, transform };
}
export function nodeCorners(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
): readonly Point[] {
  return projectedBoundsPoints(doc, id, overrides, false);
}
/** World-space points enclosing actual geometry. Unlike nodeCorners, these
 * need not be the transformed corners of the shape's local resize box. */
export function nodeBoundsPoints(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
): readonly Point[] {
  return projectedBoundsPoints(doc, id, overrides, true);
}
function projectedBoundsPoints(
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides,
  tight: boolean
): readonly Point[] {
  const node = Object.hasOwn(overrides, id) ? overrides[id] : doc.items[id];
  if (!node) return [];
  if (isShape(node)) {
    const { item, transform } = shapeProjection(doc, id, overrides);
    const definition = shapeDefinition(node.type);
    if (tight && definition.transformedBounds)
      return corners(definition.transformedBounds(item!, transform));
    return corners(definition.bounds(item!)).map((p) =>
      transformPoint(transform, p)
    );
  }
  return children(doc, id).flatMap((child) =>
    projectedBoundsPoints(doc, child, overrides, tight)
  );
}
export const worldBounds = (
  doc: GraphicsDocument,
  id: string,
  overrides: SceneOverrides = {}
) => enclosing(nodeBoundsPoints(doc, id, overrides));
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
const hitIndexes = new WeakMap<
  GraphicsDocument,
  ReturnType<typeof buildHitIndex>
>();
function buildHitIndex(doc: GraphicsDocument) {
  return drawableIds(doc).map((id) => {
    const projection = shapeProjection(doc, id);
    const item = projection.item!;
    const worldTransform = projection.transform;
    const bounds = worldBounds(doc, id);
    const stroke = resolveAppearance(item.appearance).strokeWidth / 2;
    const padding =
      stroke *
      Math.max(
        Math.hypot(worldTransform[0], worldTransform[2]),
        Math.hypot(worldTransform[1], worldTransform[3])
      );
    return {
      id,
      item,
      worldTransform,
      local: inverse(worldTransform),
      bounds,
      padding,
    };
  });
}
export function hitTest(
  doc: GraphicsDocument,
  point: Point,
  deep = false,
  tolerance = 0
): string | undefined {
  let index = hitIndexes.get(doc);
  if (!index) {
    index = buildHitIndex(doc);
    if (Object.isFrozen(doc) && Object.isFrozen(doc.items))
      hitIndexes.set(doc, index);
  }
  for (let i = index.length - 1; i >= 0; i--) {
    const { id, item, worldTransform, local, bounds, padding } = index[i]!;
    const margin = padding + tolerance;
    if (
      point.x < bounds.x - margin ||
      point.y < bounds.y - margin ||
      point.x > bounds.x + bounds.width + margin ||
      point.y > bounds.y + bounds.height + margin
    )
      continue;
    if (
      shapeDefinition(item.type).hitTest(item, transformPoint(local, point), {
        worldTransform,
        tolerance,
      })
    )
      return deep ? id : outermost(doc, id);
  }
}
export function boxHits(doc: GraphicsDocument, box: Bounds): readonly string[] {
  return [
    ...new Set(
      drawableIds(doc)
        .filter((id) => {
          const { item: node, transform } = shapeProjection(doc, id);
          return (
            isShape(node) &&
            shapeDefinition(node.type).intersectsBox(node, transform, box)
          );
        })
        .map((id) => outermost(doc, id))
    ),
  ];
}
// Only trust objects frozen here, not caller-owned shallow Object.freeze values.
// Weak collections do not retain discarded documents or history entries.
const frozenDocuments = new WeakSet<GraphicsDocument>();
const frozenItems = new WeakSet<GraphicsItem>();
const frozenGeometries = new WeakMap<object, ShapeKind>();

export function freezeDocument(doc: GraphicsDocument): GraphicsDocument {
  if (frozenDocuments.has(doc)) return doc;
  if (doc.items[doc.rootId]?.type !== 'surface')
    throw new Error('Invalid scene root');
  const items: Record<string, GraphicsItem> = Object.create(null);
  const siblingKeys = new Map<string, Set<string>>();
  for (const [id, node] of Object.entries(doc.items)) {
    if (
      !node ||
      (node.type !== 'surface' && node.type !== 'group' && !isShape(node))
    )
      throw new Error('Invalid node type');
    if (id !== node.id) throw new Error('Node identity mismatch');
    if (node.type === 'surface') {
      if (id !== doc.rootId)
        throw new Error('Only one surface root per document is supported');
      const frozen = frozenItems.has(node) ? node : Object.freeze({ ...node });
      frozenItems.add(frozen);
      Object.defineProperty(items, id, {
        value: frozen,
        enumerable: true,
      });
      continue;
    }
    if (
      !Array.isArray(node.transform) ||
      node.transform.length !== 6 ||
      !node.transform.every(Number.isFinite)
    )
      throw new Error('Invalid transform');
    if (isShape(node) && !validAppearance(node.appearance))
      throw new Error('Invalid appearance');
    inverse(node.transform);
    if (!isSortKey(node.placement.sortKey))
      throw new Error('Invalid sibling order');
    const used = siblingKeys.get(node.placement.parentId) ?? new Set<string>();
    if (used.has(node.placement.sortKey))
      throw new Error('Duplicate sibling sort key');
    used.add(node.placement.sortKey);
    siblingKeys.set(node.placement.parentId, used);
    const parent = doc.items[node.placement.parentId];
    if (!parent || isShape(parent)) throw new Error('Invalid parent');
    const seen = new Set([id]);
    let ancestor: GraphicsItem | undefined = parent;
    while (ancestor && ancestor.type !== 'surface') {
      if (seen.has(ancestor.id)) throw new Error('Containment cycle');
      seen.add(ancestor.id);
      ancestor = doc.items[ancestor.placement.parentId];
    }
    if (ancestor?.id !== doc.rootId) throw new Error('Unreachable node');
    if (
      isShape(node) &&
      frozenGeometries.get(node.geometry) !== node.type &&
      !shapeDefinition(node.type).validateGeometry(node.geometry)
    )
      throw new Error(`Invalid ${node.type} geometry`);
    if (node.type === 'connector') {
      for (const end of [node.geometry.start, node.geometry.end]) {
        if (!end.binding) continue;
        const target = doc.items[end.binding.targetId];
        if (
          end.binding.targetId === id ||
          (target && (!isShape(target) || target.type === 'connector'))
        )
          throw new Error('Invalid connector target');
      }
    }
    // The registry preserves the validated node kind/geometry correlation.
    const frozen = (
      frozenItems.has(node)
        ? node
        : Object.freeze({
            ...node,
            placement: Object.freeze({ ...node.placement }),
            transform: Object.freeze([...node.transform]) as Matrix,
            ...(isShape(node)
              ? {
                  geometry:
                    frozenGeometries.get(node.geometry) === node.type
                      ? node.geometry
                      : shapeDefinition(node.type).freezeGeometry(
                          node.geometry
                        ),
                  appearance: Object.freeze({ ...node.appearance }),
                }
              : {}),
          })
    ) as typeof node;
    frozenItems.add(frozen);
    if (isShape(frozen)) frozenGeometries.set(frozen.geometry, frozen.type);
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
  frozenDocuments.add(result);
  return result;
}
export function createScene(
  seed: readonly GraphicsItem[] = []
): GraphicsDocument {
  const rootId = 'scene-root';
  const items: Record<string, GraphicsItem> = {
    [rootId]: { id: rootId, type: 'surface' },
  };
  for (const node of seed) {
    if (Object.hasOwn(items, node.id)) throw new Error('Duplicate node ID');
    Object.defineProperty(items, node.id, { value: node, enumerable: true });
  }
  return freezeDocument({ rootId, items });
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
  const retained = new Set(
    Object.keys(doc.items).filter((id) => !removed.has(id))
  );
  return freezeDocument({
    ...doc,
    items: Object.fromEntries(
      Object.entries(doc.items)
        .filter(([id]) => retained.has(id))
        .map(([id, item]) => [
          id,
          item.type === 'connector'
            ? retainConnectorBindings(doc, item, retained)
            : item,
        ])
    ),
  });
}
export function reparent(
  doc: GraphicsDocument,
  id: string,
  parentId: string,
  position: LayerPosition = 'front'
): GraphicsDocument {
  const node = doc.items[id];
  if (!node || node.type === 'surface')
    throw new Error('Cannot reparent root or missing node');
  const siblings = children(doc, parentId).filter((key) => key !== id);
  const index = insertionIndex(siblings, position);
  if (
    node.placement.parentId === parentId &&
    children(doc, parentId).indexOf(id) === index
  )
    return doc;
  const sortKey = keysAt(doc, siblings, index, 1)[0]!;
  const transform = multiply(
    inverse(worldMatrix(doc, parentId)),
    worldMatrix(doc, id)
  );
  return freezeDocument({
    ...doc,
    items: {
      ...doc.items,
      [id]: { ...node, placement: { parentId, sortKey }, transform },
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
    placement: { parentId, sortKey: first.placement.sortKey },
    transform: IDENTITY,
  };
  for (const key of ordered) {
    const n = items[key];
    if (n && n.type !== 'surface')
      items[key] = { ...n, placement: { ...n.placement, parentId: id } };
  }
  const backmost = doc.items[ordered[0]!];
  if (backmost && backmost.type !== 'surface')
    items[id] = {
      ...items[id],
      placement: { parentId, sortKey: backmost.placement.sortKey },
    };
  return freezeDocument({ ...doc, items });
}
export function ungroupNode(
  doc: GraphicsDocument,
  id: string
): GraphicsDocument {
  const group = doc.items[id];
  if (group?.type !== 'group') throw new Error('Not a group');
  const parentId = group.placement.parentId;
  const siblings = children(doc, parentId);
  const descendants = children(doc, id);
  const keys = keysAt(
    doc,
    siblings.filter((key) => key !== id),
    siblings.indexOf(id),
    descendants.length
  );
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    doc.items
  );
  descendants.forEach((child, index) => {
    const node = items[child];
    if (node && node.type !== 'surface')
      items[child] = {
        ...node,
        placement: { parentId, sortKey: keys[index]! },
        transform: multiply(group.transform, node.transform),
      };
  });
  delete items[id];
  return freezeDocument({ ...doc, items });
}
