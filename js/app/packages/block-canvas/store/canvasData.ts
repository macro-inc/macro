import {
  edgeToCollisionData,
  getEdgeEndVectors,
} from '@block-canvas/util/connectors';
import { createBlockSignal, useBlockId } from '@core/block';
import { filterMapAsync } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { nanoid } from 'nanoid';
import { batch, createMemo } from 'solid-js';
import {
  type Canvas,
  type CanvasEdge,
  type CanvasEntity,
  type CanvasGroup,
  type CanvasId,
  type CanvasNode,
  EdgeSchema,
  GroupSchema,
  NodeSchema,
  type PencilNode,
} from '../model/CanvasModel';
import { blockDataSignal } from '../signal/canvasBlockData';
import { useSelection } from '../signal/selection';
import { untrackMentionsInTextNode } from '../util/mentions';
import { Rect, type Rectangle } from '../util/rectangle';
import { createRenderQueue } from '../util/renderQueue';
import { sharedInstance } from '../util/sharedInstance';
import { type Vector2, vec2 } from '../util/vector2';
import { useGetEdge, useGetGroup, useGetNode } from './getNodeEdge';
import { edgesStore, groupStore, nodesStore } from './nodesStore';

export const renderQueue = sharedInstance(() => {
  return createRenderQueue(nodesStore, edgesStore, groupStore);
});

export const previewRenderQueue = sharedInstance(() => {
  return createRenderQueue(nodesStore, edgesStore, groupStore);
});

export const debugRenderQueue = sharedInstance(() => {
  return createRenderQueue(nodesStore, edgesStore, groupStore);
});

export const highestOrderSignal = createBlockSignal<number>(0);

const lastCreatedNodeId = createBlockSignal<CanvasId>();

// TODO (seamus) : This pending updates thing is a stop gap until the save logic
// is refined and integrated into undo/redo system.
// Since it's a temp. solution, I've left it as a shared signal between nodes and edges -Ness
export const pendingUpdates = createBlockSignal(false);

// I really should just update the canvasFile signal as that's the pattern I intend to use for PDF
// But I'm not sure what kind of effects the derived signal would have so I'll just play it safe
export const currentSavedFile = createBlockSignal<Blob | null>(null);

export interface OperationOptions {
  autosave?: boolean;
  preview?: boolean;
  debug?: boolean;
}

export const useSetAllNodes = sharedInstance(() => {
  const [, setStore] = nodesStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const rq = renderQueue();

  return createCallback((nodes: CanvasNode[], opts?: OperationOptions) => {
    setStore(Object.fromEntries(nodes.map((node) => [node.id, node])));
    batch(() => {
      for (const node of nodes) {
        rq.addNode(node.id);
      }
    });
    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useDeleteNode = sharedInstance(() => {
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const getNode = useGetNode();
  const getEdge = useGetEdge();
  const disconnectEdge = useEdgeUtils().disconnectEdge;
  const rq = renderQueue();
  const blockId = useBlockId();
  const untrackMentionsInTextNode_ = createCallback(untrackMentionsInTextNode);

  return createCallback(async (id: CanvasId, opts?: OperationOptions) => {
    const node = getNode(id);
    if (!node) return;

    // Handle mention cleanup before deletion
    if (blockId) {
      untrackMentionsInTextNode_(node, blockId, id);
    }

    node.edges.forEach((edgeId) => {
      const edge = getEdge(edgeId);
      if (!edge) return;
      disconnectEdge(edge, id);
    });

    rq.remove(id);
    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useCreateNode = sharedInstance(() => {
  const [nodes, setStore] = nodesStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const { selectNode, deselectAll } = useSelection();
  const rq = renderQueue();
  const prq = previewRenderQueue();
  const drq = debugRenderQueue();

  return createCallback(
    (
      newNode: CanvasNode | Omit<CanvasNode, 'id'>,
      opts?: OperationOptions & { selectOnCreate?: boolean }
    ) => {
      let id = nanoid(8);
      if ('id' in newNode) id = newNode.id;
      let tryCount = 0;
      while (id in nodes) {
        id += tryCount;
      }
      setStore(id, { ...newNode, id: id });
      if (opts?.preview) {
        prq.addNode(id);
      } else if (opts?.debug) {
        drq.addNode(id);
      } else {
        rq.addNode(id);
      }

      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();

      deselectAll();
      if (opts?.selectOnCreate === false) {
        selectNode(id);
      }
      return nodes[id];
    }
  );
});

export const useUpdateNode = sharedInstance(() => {
  const [store, setStore] = nodesStore;
  const saveCanvasData = useSaveCanvasData();
  const [, setPendingUpdates] = pendingUpdates;

  return createCallback(
    (id: CanvasId, updates: Partial<CanvasNode>, opts?: OperationOptions) => {
      if (!store[id]) return;
      setStore(id, { ...store[id], ...updates });
      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();
    }
  );
});

export const useCanvasNodes = sharedInstance(() => {
  const [pending, setPending] = pendingUpdates;
  const [lastCreated, setLastCreated] = lastCreatedNodeId;
  const saveCanvasData = useSaveCanvasData();
  const getNode = useGetNode();
  const rq = renderQueue();
  const prq = previewRenderQueue();
  return {
    get: getNode,
    initialize: useSetAllNodes(),
    delete: useDeleteNode(),
    createNode: useCreateNode(),
    updateNode: useUpdateNode(),
    lastCreated,
    batchUpdate: (fn: () => void, opts?: OperationOptions) => {
      batch(fn);
      if (opts?.autosave && pending()) {
        saveCanvasData();
      }
    },
    setLastCreated,
    save: useSaveCanvasData(),
    unsaved: () => pending(),
    clearPreview: () => prq.clear(),
    visible: createMemo(() => {
      return rq.nodes().map((renderable) => getNode(renderable.id));
    }),
    setVisible: (ids: CanvasId[], opts?: OperationOptions) => {
      rq.clear();
      for (const id of ids) {
        rq.addNode(id);
      }
      setPending(true);
      if (opts?.autosave) saveCanvasData();
    },
  };
});

export const useSetAllEdges = sharedInstance(() => {
  const [, setStore] = edgesStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const rq = renderQueue();

  return createCallback((edges: CanvasEdge[], opts?: OperationOptions) => {
    setStore(Object.fromEntries(edges.map((edge) => [edge.id, edge])));
    batch(() => {
      for (const edge of edges) {
        rq.addEdge(edge.id);
      }
    });
    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useDeleteEdge = sharedInstance(() => {
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const getEdge = useGetEdge();
  const getNode = useGetNode();
  const updateNode = useUpdateNode();
  const rq = renderQueue();

  return createCallback((id: CanvasId, opts?: OperationOptions) => {
    const edge = getEdge(id);
    if (!edge) return;
    if (edge.from.type === 'connected') {
      const fromNode = getNode(edge.from.node);
      if (fromNode) {
        updateNode(fromNode.id, {
          edges: fromNode.edges.filter((e) => e !== id),
        });
      }
    }
    if (edge.to.type === 'connected') {
      const toNode = getNode(edge.to.node);
      if (toNode) {
        updateNode(toNode.id, {
          edges: toNode.edges.filter((e) => e !== id),
        });
      }
    }

    rq.remove(id);
    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useCreateEdge = sharedInstance(() => {
  const [, setStore] = edgesStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const getNode = useGetNode();
  const updateNode = useUpdateNode();
  const rq = renderQueue();
  const prq = previewRenderQueue();
  const drq = debugRenderQueue();

  return createCallback(
    (
      newEdge: CanvasEdge | Omit<CanvasEdge, 'id'>,
      opts?: OperationOptions & { selectOnCreate?: boolean }
    ) => {
      const id = 'id' in newEdge ? newEdge.id : nanoid(8);
      setStore(id, { ...newEdge, id });

      if (opts?.preview) {
        prq.addEdge(id);
      } else if (opts?.debug) {
        drq.addEdge(id);
      } else {
        rq.addEdge(id);
      }
      setPendingUpdates(true);

      if (opts?.autosave) saveCanvasData();

      if (newEdge.from.type === 'connected') {
        const oldEdges = getNode(newEdge.from.node)?.edges;
        updateNode(newEdge.from.node, {
          edges: [...oldEdges, id],
        });
      }
      if (newEdge.to.type === 'connected') {
        const oldEdges = getNode(newEdge.to.node)?.edges;
        updateNode(newEdge.to.node, {
          edges: [...oldEdges, id],
        });
      }

      return { id, ...newEdge };
    }
  );
});

export const useUpdateEdge = sharedInstance(() => {
  const [store, setStore] = edgesStore;
  const saveCanvasData = useSaveCanvasData();
  const [, setPendingUpdates] = pendingUpdates;
  const getEdge = useGetEdge();
  const getNode = useGetNode();
  const updateNode = useUpdateNode();

  return createCallback(
    (id: CanvasId, updates: Partial<CanvasEdge>, opts?: OperationOptions) => {
      if (!store[id]) return;

      const edge = getEdge(id);
      if (!edge) return;
      if (updates.from?.type === 'free' && edge.from.type === 'connected') {
        const fromNode = getNode(edge.from.node);
        if (fromNode) {
          updateNode(fromNode.id, {
            edges: fromNode.edges.filter((e) => e !== id),
          });
        }
      }
      if (updates.to?.type === 'free' && edge.to.type === 'connected') {
        const toNode = getNode(edge.to.node);
        if (toNode) {
          updateNode(toNode.id, {
            edges: toNode.edges.filter((e) => e !== id),
          });
        }
      }
      if (updates.from?.type === 'connected' && edge.from.type === 'free') {
        const fromNode = getNode(updates.from.node);
        if (fromNode) {
          updateNode(fromNode.id, {
            edges: [...fromNode.edges, id],
          });
        }
      }
      if (updates.to?.type === 'connected' && edge.to.type === 'free') {
        const toNode = getNode(updates.to.node);
        if (toNode) {
          updateNode(toNode.id, {
            edges: [...toNode.edges, id],
          });
        }
      }

      setStore(id, { ...store[id], ...updates });
      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();
    }
  );
});

export const useCanvasEdges = sharedInstance(() => {
  const [pending, setPending] = pendingUpdates;
  const getEdge = useGetEdge();
  const saveCanvasData = useSaveCanvasData();
  const rq = renderQueue();
  const prq = previewRenderQueue();
  return {
    get: getEdge,
    initialize: useSetAllEdges(),
    delete: useDeleteEdge(),
    createEdge: useCreateEdge(),
    updateEdge: useUpdateEdge(),
    batchUpdate: (fn: () => void, opts?: OperationOptions) => {
      batch(fn);
      if (opts?.autosave && pending()) {
        saveCanvasData();
      }
    },
    save: useSaveCanvasData(),
    unsaved: () => pending(),
    clearPreview: () => prq.clear(),
    visible: createMemo(() => {
      return rq.edges().map((renderable) => getEdge(renderable.id));
    }),
    setVisible: (ids: CanvasId[], opts?: OperationOptions) => {
      rq.clear();
      for (const id of ids) {
        rq.addEdge(id);
      }
      setPending(true);
      if (opts?.autosave) saveCanvasData();
    },
  };
});

export type EdgeEndPoints = {
  from: Vector2;
  to: Vector2;
};

export const useEdgeUtils = sharedInstance(() => {
  const getNode = useGetNode();
  const updateEdge = useUpdateEdge();

  const getRawEndPoints = (edge: CanvasEdge): EdgeEndPoints => {
    const { from, to } = edge;
    const val: EdgeEndPoints = { from: vec2(0, 0), to: vec2(0, 0) };

    if (from.type === 'free') {
      val.from = vec2(from.x, from.y);
    } else if (from.type === 'connected') {
      const { node: nodeId, side } = from;
      const nodeData = getNode(nodeId);
      if (nodeData) {
        const pos = Rect.centerPointOfEdge(nodeData, side);
        val.from = vec2(pos.x, pos.y);
      } else {
        val.from = vec2(0, 0);
      }
    }

    if (to.type === 'free') {
      val.to = vec2(to.x, to.y);
    } else if (to.type === 'connected') {
      const { node: nodeId, side } = to;
      const nodeData = getNode(nodeId);
      if (nodeData) {
        const pos = Rect.centerPointOfEdge(nodeData, side);
        val.to = vec2(pos.x, pos.y);
      } else {
        val.to = vec2(0, 0);
      }
    }
    return val;
  };

  return {
    getRawEndPoints,
    getEdgeEndVectors(edge: CanvasEdge) {
      const { from, to } = getRawEndPoints(edge);
      return getEdgeEndVectors(edge, [from, to]);
    },
    disconnectEdge(edge: CanvasEdge, nodeId: CanvasId) {
      const { from, to } = edge;
      if (from.type === 'connected' && from.node === nodeId) {
        const { node: nodeId, side } = from;
        const nodeData = getNode(nodeId);
        if (nodeData) {
          const pos = Rect.centerPointOfEdge(nodeData, side);
          updateEdge(edge.id, {
            from: {
              type: 'free',
              x: pos.x,
              y: pos.y,
            },
          });
        }
      }
      if (to.type === 'connected' && to.node === nodeId) {
        const { node: nodeId, side } = to;
        const nodeData = getNode(nodeId);
        if (nodeData) {
          const pos = Rect.centerPointOfEdge(nodeData, side);
          updateEdge(edge.id, {
            to: {
              type: 'free',
              x: pos.x,
              y: pos.y,
            },
          });
        }
      }
    },
  };
});

export const useBoundingBox = sharedInstance(() => {
  const { getRawEndPoints } = useEdgeUtils();
  return (rectangles: Array<Rectangle | CanvasNode>, edges: CanvasEdge[]) => {
    const min = vec2(Infinity, Infinity);
    const max = vec2(-Infinity, -Infinity);
    for (const rect of rectangles) {
      let xVal = rect.x;
      let yVal = rect.y;
      let width = rect.width;
      let height = rect.height;

      // apply the manual scale from pencil node
      if ('wScale' in rect) {
        width *= (rect as PencilNode).wScale;
      }
      if ('hScale' in rect) {
        height *= (rect as PencilNode).hScale;
      }

      min.x = Math.min(min.x, xVal, xVal + width);
      min.y = Math.min(min.y, yVal, yVal + height);
      max.x = Math.max(max.x, xVal, xVal + width);
      max.y = Math.max(max.y, yVal, yVal + height);
    }
    for (const edge of edges) {
      const endPoints = getRawEndPoints(edge);
      const points = edgeToCollisionData(edge, [endPoints.from, endPoints.to]);
      for (const point of points) {
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
      }
    }
    return Rect.fromPoints(min, max);
  };
});

export const useSetAllGroups = sharedInstance(() => {
  const [, setStore] = groupStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();

  return createCallback((groups: CanvasGroup[], opts?: OperationOptions) => {
    setStore(Object.fromEntries(groups.map((group) => [group.id, group])));
    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useDeleteGroup = sharedInstance(() => {
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const getNode = useGetNode();
  const getEdge = useGetEdge();
  const getGroup = useGetGroup();
  const updateNode = useUpdateNode();
  const updateEdge = useUpdateEdge();
  const { selectedNodeIds, selectedEdgeIds } = useSelection();

  return createCallback((opts?: OperationOptions) => {
    const groupIds = new Set<string | undefined>();
    selectedNodeIds().forEach((nodeId: string) => {
      const node = getNode(nodeId);
      const groupId = node?.groupId;
      if (node && groupId) {
        groupIds.add(groupId);
        updateNode(nodeId, {
          groupId: undefined,
          sortOrder: getGroup(groupId).sortOrder + node.sortOrder / 1000,
        });
      }
    });
    selectedEdgeIds().forEach((edgeId: string) => {
      const edge = getEdge(edgeId);
      const groupId = edge?.groupId;
      if (edge && groupId) {
        groupIds.add(getEdge(edgeId)?.groupId);
        updateEdge(edgeId, {
          groupId: undefined,
          sortOrder: getGroup(groupId).sortOrder + edge.sortOrder / 1000,
        });
      }
    });

    setPendingUpdates(true);
    if (opts?.autosave) saveCanvasData();
  });
});

export const useCreateGroup = sharedInstance(() => {
  const [groups, setStore] = groupStore;
  const [, setPendingUpdates] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const { selectedNodeIds, selectedEdgeIds, selectedNodes } = useSelection();
  const updateNode = useUpdateNode();
  const updateEdge = useUpdateEdge();
  const rq = renderQueue();

  return createCallback(
    (
      existingId?: string,
      existingSortOrder?: number,
      existingLayer?: number,
      existingChildNodes?: string[],
      existingChildEdges?: string[],
      opts?: OperationOptions
    ) => {
      const id = existingId ?? nanoid(8);

      const sortOrder =
        existingSortOrder ??
        Math.max(...selectedNodes().map((n: CanvasNode) => n.sortOrder)) + 0.5;
      const layer =
        existingLayer ??
        Math.max(...selectedNodes().map((n: CanvasNode) => n.layer));
      setStore(id, {
        id,
        childNodes: existingChildNodes ?? Array.from(selectedNodeIds()),
        childEdges: existingChildEdges ?? Array.from(selectedEdgeIds()),
        sortOrder,
        layer,
      });

      selectedNodeIds().forEach((nodeId: string) => {
        updateNode(nodeId, { groupId: id });
      });
      selectedEdgeIds().forEach((edgeId: string) => {
        updateEdge(edgeId, { groupId: id });
      });

      // Normalize to maintain stacking order/avoid same sortOrder on copy
      rq.normalize();

      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();

      return groups[id];
    }
  );
});

export const useUpdateGroup = sharedInstance(() => {
  const [store, setStore] = groupStore;
  const saveCanvasData = useSaveCanvasData();
  const [, setPendingUpdates] = pendingUpdates;

  return createCallback(
    (id: CanvasId, updates: Partial<CanvasGroup>, opts?: OperationOptions) => {
      if (!store[id]) return;
      setStore(id, { ...store[id], ...updates });
      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();
    }
  );
});

export const useAddNodeToGroup = sharedInstance(() => {
  const [store, setStore] = groupStore;
  const saveCanvasData = useSaveCanvasData();
  const [, setPendingUpdates] = pendingUpdates;

  return createCallback(
    (id: CanvasId, nodeId: string, opts?: OperationOptions) => {
      if (!store[id]) return;
      const existingChildren = store[id].childNodes ?? [];
      setStore(id, { ...store[id], childNodes: [...existingChildren, nodeId] });
      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();
    }
  );
});

export const useAddEdgeToGroup = sharedInstance(() => {
  const [store, setStore] = groupStore;
  const saveCanvasData = useSaveCanvasData();
  const [, setPendingUpdates] = pendingUpdates;

  return createCallback(
    (id: CanvasId, edgeId: string, opts?: OperationOptions) => {
      if (!store[id]) return;
      const existingChildren = store[id].childEdges ?? [];
      setStore(id, { ...store[id], childEdges: [...existingChildren, edgeId] });
      setPendingUpdates(true);
      if (opts?.autosave) saveCanvasData();
    }
  );
});

export const useCanvasGroups = sharedInstance(() => {
  const [pending, setPending] = pendingUpdates;
  const saveCanvasData = useSaveCanvasData();
  const getGroup = useGetGroup();
  const rq = renderQueue();
  const prq = previewRenderQueue();
  return {
    get: getGroup,
    initialize: useSetAllGroups(),
    delete: useDeleteGroup(),
    createGroup: useCreateGroup(),
    update: useUpdateGroup(),
    addNode: useAddNodeToGroup(),
    addEdge: useAddEdgeToGroup(),
    batchUpdate: (fn: () => void, opts?: OperationOptions) => {
      batch(fn);
      if (opts?.autosave && pending()) {
        saveCanvasData();
      }
    },
    save: useSaveCanvasData(),
    unsaved: () => pending(),
    clearPreview: () => prq.clear(),
    visible: createMemo(() => {
      return rq.nodes().map((renderable) => getGroup(renderable.id));
    }),
    setVisible: (ids: CanvasId[], opts?: OperationOptions) => {
      rq.clear();
      for (const id of ids) {
        rq.addGroup(id);
      }
      setPending(true);
      if (opts?.autosave) saveCanvasData();
    },
  };
});

export const useLoadCanvasData = sharedInstance(() => {
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const groups = useCanvasGroups();
  const setHighestOrder = highestOrderSignal.set;
  const assertLayerAndSortOrder = (entity: CanvasEntity) => {
    if (entity.layer === undefined) entity.layer = 0;
    if (entity.sortOrder === undefined) entity.sortOrder = 0;
  };
  return async (json: Canvas) => {
    let highestSortOrder = 0;

    const nodeMap = await filterMapAsync<any, CanvasNode>(
      json.nodes || [],
      async (node) => {
        if ((await NodeSchema.safeParseAsync(node)).success) {
          const n = node as CanvasNode;
          if (n.sortOrder > highestSortOrder) highestSortOrder = n.sortOrder;
          assertLayerAndSortOrder(n);
          return n;
        } else {
          try {
            NodeSchema.parse(node);
          } catch (e) {
            console.error('error parsing node', e);
          }
        }
      }
    );
    const edgeMap = await filterMapAsync<any, CanvasEdge>(
      json.edges || [],
      async (edge) => {
        if ((await EdgeSchema.safeParseAsync(edge)).success) {
          const e = edge as CanvasEdge;
          if (e.sortOrder > highestSortOrder) highestSortOrder = e.sortOrder;
          assertLayerAndSortOrder(e);
          return e;
        }
      }
    );
    const groupMap = await filterMapAsync<any, CanvasGroup>(
      json.groups || [],
      async (group) => {
        if ((await GroupSchema.safeParseAsync(group)).success) {
          const g = group as CanvasGroup;
          if (g.sortOrder > highestSortOrder) highestSortOrder = g.sortOrder;
          assertLayerAndSortOrder(g);
          return g;
        }
      }
    );

    nodes.initialize(nodeMap);
    edges.initialize(edgeMap);
    groups.initialize(groupMap);
    setHighestOrder(highestSortOrder);
  };
});

export const useExportCanvasData = sharedInstance(() => {
  const getNode = useGetNode();
  const getEdge = useGetEdge();
  const [canvasGroups] = groupStore;
  const rq = renderQueue();
  return (): Canvas => {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    const groups: CanvasGroup[] = [];

    const groupIds = new Set<string>();

    for (const renderable of rq.sorted()) {
      if (renderable.type === 'node') {
        const node = getNode(renderable.id);
        if (node && (!('status' in node) || node.status !== 'loading'))
          if (node.groupId) groupIds.add(node.groupId);
        nodes.push(node);
      }
      if (renderable.type === 'edge') {
        const edge = getEdge(renderable.id);
        if (edge.groupId) groupIds.add(edge.groupId);
        if (edge) edges.push(edge);
      }
    }
    for (const group of Object.values(canvasGroups)) {
      if (groupIds.has(group.id)) groups.push(group);
    }
    return { nodes, edges, groups } as Canvas;
  };
});

// save block-level canvas data to DSS
export const useSaveCanvasData = sharedInstance(() => {
  const exportCanvasData = useExportCanvasData();
  const [, setPendingUpdates] = pendingUpdates;
  const setCurrentSavedFile = currentSavedFile.set;

  return debounce(
    createCallback(async () => {
      const dssFile = blockDataSignal()?.dssFile;
      if (!dssFile) {
        console.error('no dss file');
        return;
      }
      const { documentId } = dssFile.getMetadata();

      const canvas = exportCanvasData();
      const encoder = new TextEncoder();
      const buffer = encoder.encode(JSON.stringify(canvas));

      const file = new Blob([buffer], { type: 'application/x-macro-canvas' });

      const saveRes = await storageServiceClient.simpleSave({
        documentId,
        file,
      });

      if (isErr(saveRes)) {
        console.error('error on canvas save');
      }

      setCurrentSavedFile(() => file);

      setPendingUpdates(false);
    }),
    1500
  );
});
