import type { CanvasId } from '@block-canvas/model/CanvasModel';
import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { createCallback } from '@solid-primitives/rootless';
import { useCanvasDocument } from '../context/canvas-document-context';

export const useGetEdge = sharedInstance(() => {
  const [store] = useCanvasDocument().state.stores.edges;
  return createCallback((id: CanvasId) => store[id]);
});

export const useGetNode = sharedInstance(() => {
  const [store] = useCanvasDocument().state.stores.nodes;
  return createCallback((id: CanvasId) => store[id]);
});

export const useGetGroup = sharedInstance(() => {
  const [store] = useCanvasDocument().state.stores.groups;
  return createCallback((id: CanvasId) => store[id]);
});
