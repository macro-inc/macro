import { highestOrderSignal } from '@block-canvas/store/canvasData';
import type { BlockStore } from '@core/block';
import { createMemo, createSignal, untrack } from 'solid-js';
import {
  type CanvasEdge,
  type CanvasEntity,
  type CanvasGroup,
  type CanvasId,
  type CanvasNode,
  isCanvasNode,
} from '../model/CanvasModel';

export type Renderable = {
  id: CanvasId;
  type: 'node' | 'edge' | 'group';
  sortOrder: number;
  layer: number;
};

function createRenderable(entity: CanvasEntity): Renderable {
  return {
    id: entity.id,
    type: isCanvasNode(entity) ? 'node' : 'edge',
    sortOrder: entity.sortOrder ?? 0,
    layer: 0,
  };
}

/**
 * Update the layer and order of a renderable in place by reading from the
 * canvas data stores.
 */
function updateSort(
  item: Renderable,
  getNode: (id: CanvasId) => CanvasNode,
  getEdge: (id: CanvasId) => CanvasEdge,
  getGroup: (id: CanvasId) => CanvasGroup
): void {
  if (item.type === 'node') {
    const node = getNode(item.id);
    const group = node.groupId ? getGroup(node.groupId) : undefined;
    item.layer = group ? group.layer : node.layer;
    item.sortOrder = group
      ? group.sortOrder + node.sortOrder / 1000
      : node.sortOrder;
    return;
  }
  if (item.type === 'edge') {
    const edge = getEdge(item.id);
    const group = edge.groupId ? getGroup(edge.groupId) : undefined;
    const connected =
      edge.to.type === 'connected' || edge.from.type === 'connected';

    if (!connected) {
      item.layer = group ? group.layer : edge.layer;
      item.sortOrder = group
        ? group.sortOrder + edge.sortOrder / 1000
        : edge.sortOrder;
      return;
    }

    let sortOrder = -Infinity;
    let layer = 0;
    if (edge.from.type === 'connected') {
      const fromNode = getNode(edge.from.node);
      if (fromNode.layer > layer) {
        layer = fromNode.layer;
      }
      if (fromNode.sortOrder > sortOrder) {
        sortOrder = fromNode.sortOrder + 0.5;
      }
    }

    if (edge.to.type === 'connected') {
      const toNode = getNode(edge.to.node);
      if (toNode.layer > layer) {
        layer = toNode.layer;
      }
      if (toNode.sortOrder > sortOrder) {
        sortOrder = toNode.sortOrder + 0.5;
      }
    }
    item.layer = layer;
    item.sortOrder = sortOrder;
  }
}

function compare(a: Renderable, b: Renderable): number {
  const aLayer = a.layer ?? 0;
  const bLayer = b.layer ?? 0;
  if (aLayer !== bLayer) {
    return aLayer - bLayer;
  }
  const aSortOrder = a.sortOrder ?? 0;
  const bSortOrder = b.sortOrder ?? 0;
  if (aSortOrder !== bSortOrder) {
    return aSortOrder - bSortOrder;
  }
  return 0;
}

export function createRenderQueue(
  nodeStore: BlockStore<Record<CanvasId, CanvasNode>>,
  edgeStore: BlockStore<Record<CanvasId, CanvasEdge>>,
  groupStore: BlockStore<Record<CanvasId, CanvasGroup>>
) {
  const [nodes, setNodes] = nodeStore;
  const [edges, setEdges] = edgeStore;
  const [groups, setGroups] = groupStore;
  const [list, setList] = createSignal<Renderable[]>([]);
  const setHighestOrder = highestOrderSignal.set;

  const sorted = createMemo(() => {
    const _list = list();

    for (const item of _list) {
      updateSort(
        item,
        (id) => nodes[id],
        (id) => edges[id],
        (id) => groups[id]
      );
    }

    return [..._list].sort(compare);
  });

  return {
    addNode(id: CanvasId) {
      const node = nodes[id];
      if (node) {
        const renderable = createRenderable(node);
        setList((prev) => [...prev, renderable]);
      }
    },

    addEdge: (id: CanvasId) => {
      const edge = edges[id];
      if (edge) {
        const renderable = createRenderable(edge);
        setList((prev) => [...prev, renderable]);
      }
    },

    addGroup: (id: CanvasId) => {
      const group = groups[id];
      if (group) {
        const renderable = createRenderable(group);
        setList((prev) => [...prev, renderable]);
      }
    },

    remove(id: CanvasId) {
      setList((prev) => prev.filter((renderable) => renderable.id !== id));
    },

    sorted: sorted,

    list: list,

    length: () => list().length,

    nodes: createMemo(() => {
      return list().filter((renderable) => renderable.type === 'node');
    }),

    edges: createMemo(() => {
      return list().filter((renderable) => renderable.type === 'edge');
    }),

    groups: createMemo(() => {
      return list().filter((renderable) => renderable.type === 'group');
    }),

    clear() {
      setList([]);
    },

    forceSet(renderables: Renderable[]) {
      let existingById = new Map<CanvasId, Renderable>(
        list().map((r) => [r.id, r])
      );
      setList(
        renderables.map((r) => {
          if (existingById.has(r.id)) {
            existingById.get(r.id)!.sortOrder = r.sortOrder;
            return existingById.get(r.id)!;
          }
          return r;
        })
      );
    },

    normalize() {
      let order = 1;
      let lastLayer = -Infinity;
      for (const renderable of untrack(sorted)) {
        if (lastLayer !== renderable.layer) {
          lastLayer = renderable.layer;
          order = 1;
        }
        if (renderable.type === 'node') {
          setNodes(renderable.id, { sortOrder: order++ });
        } else if (renderable.type === 'edge') {
          setEdges(renderable.id, { sortOrder: order++ });
        } else if (renderable.type === 'group') {
          setGroups(renderable.id, { sortOrder: order++ });
        }
      }
      setHighestOrder(order);
    },
  };
}

export type RenderQueue = ReturnType<typeof createRenderQueue>;
