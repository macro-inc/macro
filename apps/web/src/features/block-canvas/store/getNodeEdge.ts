import type { CanvasId } from '@block-canvas/model/CanvasModel';
import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { createCallback } from '@solid-primitives/rootless';
import { edgesStore, groupStore, nodesStore } from './nodesStore';

export const useGetEdge = sharedInstance(() => {
  const [store] = edgesStore;
  return createCallback((id: CanvasId) => store[id]);
});

export const useGetNode = sharedInstance(() => {
  const [store] = nodesStore;
  return createCallback((id: CanvasId) => store[id]);
});

export const useGetGroup = sharedInstance(() => {
  const [store] = groupStore;
  return createCallback((id: CanvasId) => store[id]);
});
