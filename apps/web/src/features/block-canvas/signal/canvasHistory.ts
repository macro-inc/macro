import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { batch, untrack } from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import { useCanvasDocument } from '../context/canvas-document-context';
import type { CanvasEdge, CanvasId, CanvasNode } from '../model/CanvasModel';
import {
  renderQueue,
  useCanvasEdges,
  useCanvasNodes,
} from '../store/canvasData';
import type { Renderable } from '../util/renderQueue';
import { useSelection } from './selection';

export type Snapshot = {
  renderQueue: Renderable[];
  allNodes: Record<CanvasId, CanvasNode>;
  allEdges: Record<string, CanvasEdge>;
  selectedNodeIds: CanvasId[];
  selectedEdgeIds: string[];
  selectedGroupIds: string[];
};

const MAX_HISTORY_LENGTH = 40;

export const useCanvasHistory = sharedInstance(createHistory);

function createHistory() {
  const canvasState = useCanvasDocument().state;
  const state = canvasState.signals;
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const selection = useSelection();
  const [history, setHistory] = state.history;
  const [current, setCurrent] = state.currentHistory;
  const [currentIndex, setCurrentIndex] = state.currentHistoryIndex;
  const [allNodes, setNodeStore] = canvasState.stores.nodes;
  const [allEdges, setEdgeStore] = canvasState.stores.edges;
  const queue = renderQueue();

  function createSnapshot(): Snapshot {
    return {
      renderQueue: JSON.parse(JSON.stringify(untrack(queue.list))),
      allNodes: JSON.parse(JSON.stringify(unwrap(allNodes))),
      allEdges: JSON.parse(JSON.stringify(unwrap(allEdges))),
      selectedNodeIds: [...selection.selectedNodeIds()],
      selectedEdgeIds: [...selection.selectedEdgeIds()],
      selectedGroupIds: [...selection.selectedGroupIds()],
    };
  }

  function applySnapshot(snapshot: Snapshot) {
    batch(() => {
      queue.forceSet(snapshot.renderQueue);
      setNodeStore(reconcile(snapshot.allNodes));
      setEdgeStore(reconcile(snapshot.allEdges));
      selection.forceSetSelection(
        snapshot.selectedNodeIds,
        snapshot.selectedEdgeIds,
        snapshot.selectedGroupIds
      );
    });
  }

  function addToHistory(snapshot: Snapshot, setIndex = true) {
    const nextIndex = currentIndex() + 1;

    // kill the future.
    const newHistory = history().slice(0, nextIndex);
    newHistory.push(snapshot);

    if (newHistory.length > MAX_HISTORY_LENGTH) {
      newHistory.shift();
    }

    setHistory(newHistory);
    if (setIndex) setCurrentIndex(Math.min(nextIndex, newHistory.length - 1));
  }

  return {
    open: () => {
      setCurrent(createSnapshot());
    },

    close: () => {
      const currentSnapshot = current();
      if (!currentSnapshot) return;
      addToHistory(currentSnapshot);
      setCurrent(undefined);
    },

    undo: () => {
      // push current state to history at stack top - for the first redo
      if (currentIndex() === history().length - 1) {
        addToHistory(createSnapshot());
      }

      if (currentIndex() === 0) {
        // toast.failure('Nothing to undo');
        return;
      }

      // now jump one back
      setCurrentIndex(currentIndex() - 1);
      const previousSnapshot = history()[currentIndex()];
      if (!previousSnapshot) {
        return;
      }
      applySnapshot(previousSnapshot);
      nodes.save();
      edges.save();
    },

    redo: () => {
      const snapshot = history()[currentIndex() + 1];
      if (!snapshot) return;

      // Create a snapshot of the current state before applying the redo
      const currentSnapshot = createSnapshot();
      addToHistory(currentSnapshot, false); // Add without changing the index

      applySnapshot(snapshot);
      setCurrentIndex(currentIndex() + 1);
    },

    clearHistory: () => {
      setHistory([]);
      setCurrentIndex(-1);
      setCurrent(undefined);
    },

    getCurrentIndex: () => currentIndex(),
    getHistoryLength: () => history().length,
  };
}
