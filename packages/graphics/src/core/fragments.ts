import { inverse, multiply, translation } from './affine';
import { retainConnectorBindings } from './connectors';
import type { GraphicsDocument, GraphicsItem, Point } from './model';
import { keysAt, sortKeysBetween } from './ordering';
import {
  children,
  freezeDocument,
  paintOrder,
  roots,
  worldMatrix,
} from './scene';
import type { ConnectorEndpoint } from './shapes/connector';

/** A standalone scene whose selected roots have world-space transforms. */
export type GraphicsFragment = Readonly<{
  kind: 'macro-graphics-fragment';
  scene: GraphicsDocument;
}>;
export type IdFactory = () => string;

export function copyFragment(
  document: GraphicsDocument,
  selection: readonly string[]
): GraphicsFragment | undefined {
  const targets = new Set(roots(document, selection));
  const ordered = paintOrder(document).filter((id) => targets.has(id));
  if (!ordered.length) return;
  const scene: GraphicsDocument = {
    rootId: document.rootId,
    items: { [document.rootId]: { id: document.rootId, type: 'surface' } },
  };
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    scene.items
  );
  const keys = sortKeysBetween(null, null, ordered.length);
  const visit = (id: string, rootIndex?: number) => {
    const node = document.items[id]!;
    if (node.type === 'surface') return;
    items[id] =
      rootIndex === undefined
        ? node
        : {
            ...node,
            placement: { parentId: scene.rootId, sortKey: keys[rootIndex]! },
            transform: worldMatrix(document, id),
          };
    children(document, id).forEach((child) => visit(child));
  };
  ordered.forEach(visit);
  const retained = new Set(Object.keys(items));
  for (const id of retained) {
    const source = document.items[id];
    const copied = items[id];
    if (source?.type === 'connector' && copied?.type === 'connector')
      items[id] = {
        ...copied,
        geometry: retainConnectorBindings(document, source, retained).geometry,
      };
  }
  return {
    kind: 'macro-graphics-fragment',
    scene: freezeDocument({ ...scene, items }),
  };
}

export function parseFragment(text: string): GraphicsFragment | undefined {
  // Clipboard input is untrusted and deliberately bounded. No document migration.
  if (text.length > 2_000_000) return;
  try {
    const value = JSON.parse(text);
    if (
      value?.kind !== 'macro-graphics-fragment' ||
      !value.scene?.items ||
      Object.keys(value.scene.items).length > 5000
    )
      return;
    const scene = freezeDocument(value.scene);
    if (scene.surface || !children(scene).length) return;
    return { kind: 'macro-graphics-fragment', scene };
  } catch {
    return;
  }
}

export function pasteFragment(
  document: GraphicsDocument,
  fragment: GraphicsFragment,
  createId: IdFactory,
  offset: Point = { x: 24, y: 24 },
  parentId = document.rootId
) {
  const source = freezeDocument(fragment.scene);
  const parent = document.items[parentId];
  if (!parent || (parent.type !== 'group' && parent.type !== 'surface'))
    throw new Error('Invalid paste parent');
  const ids = paintOrder(source);
  const remap = new Map<string, string>();
  const allocated = new Set(Object.keys(document.items));
  for (const id of ids) {
    const next = createId();
    if (!next || allocated.has(next)) throw new Error('Duplicate graphics ID');
    allocated.add(next);
    remap.set(id, next);
  }
  const top = children(source);
  const keys = keysAt(
    document,
    children(document, parentId),
    children(document, parentId).length,
    top.length
  );
  const items: Record<string, GraphicsItem> = Object.assign(
    Object.create(null),
    document.items
  );
  for (const id of ids) {
    const node = source.items[id]!;
    if (node.type === 'surface') continue;
    const index = top.indexOf(id);
    const newId = remap.get(id)!;
    const mapped =
      node.type === 'connector'
        ? {
            ...node,
            geometry: {
              ...node.geometry,
              start: remapEndpoint(node.geometry.start, remap),
              end: remapEndpoint(node.geometry.end, remap),
            },
          }
        : node;
    items[newId] = {
      ...mapped,
      id: newId,
      placement: {
        parentId: index < 0 ? remap.get(node.placement.parentId)! : parentId,
        sortKey: index < 0 ? node.placement.sortKey : keys[index]!,
      },
      transform:
        index < 0
          ? node.transform
          : multiply(
              inverse(worldMatrix(document, parentId)),
              multiply(translation(offset.x, offset.y), node.transform)
            ),
    };
  }
  return {
    document: freezeDocument({ ...document, items }),
    selection: top.map((id) => remap.get(id)!),
    idMap: remap,
  };
}

function remapEndpoint(
  end: ConnectorEndpoint,
  ids: ReadonlyMap<string, string>
): ConnectorEndpoint {
  return end.binding && ids.has(end.binding.targetId)
    ? {
        ...end,
        binding: { ...end.binding, targetId: ids.get(end.binding.targetId)! },
      }
    : {
        point: end.point,
        ...(end.direction ? { direction: end.direction } : {}),
      };
}
/** Duplicate each selected subtree in its existing parent, above its siblings. */
export function duplicateNodes(
  document: GraphicsDocument,
  selection: readonly string[],
  createId: IdFactory,
  offset: Point = { x: 24, y: 24 }
) {
  const parents = new Map<string, string[]>();
  for (const id of roots(document, selection)) {
    const node = document.items[id]!;
    if (node.type === 'surface') continue;
    const ids = parents.get(node.placement.parentId) ?? [];
    ids.push(id);
    parents.set(node.placement.parentId, ids);
  }
  let next = document;
  const selected: string[] = [];
  const remapped = new Map<string, string>();
  for (const [parentId, ids] of parents) {
    const fragment = copyFragment(document, ids)!;
    const result = pasteFragment(next, fragment, createId, offset, parentId);
    next = result.document;
    for (const [source, copy] of result.idMap) remapped.set(source, copy);
    selected.push(...result.selection);
  }
  const items = { ...next.items },
    retained = new Set(remapped.keys());
  for (const [sourceId, copyId] of remapped) {
    const source = document.items[sourceId],
      copy = items[copyId];
    if (source?.type !== 'connector' || copy?.type !== 'connector') continue;
    const g = retainConnectorBindings(document, source, retained).geometry;
    items[copyId] = {
      ...copy,
      geometry: {
        ...g,
        start: remapEndpoint(g.start, remapped),
        end: remapEndpoint(g.end, remapped),
      },
    };
  }
  return { document: freezeDocument({ ...next, items }), selection: selected };
}
