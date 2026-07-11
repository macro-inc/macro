import { edgesStore, nodesStore } from '@block-canvas/store/nodesStore';
import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { createBlockSignal } from '@core/block';
import { batch, untrack } from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import type { CanvasEdge, CanvasId, CanvasNode } from '../model/CanvasModel';
import {
  renderQueue,
  useCanvasEdges,
  useCanvasNodes,
} from '../store/canvasData';
import type { Renderable } from '../util/renderQueue';
import { useSelection } from './selection';

type Snapshot = {
  renderQueue: Renderable[];
  allNodes: Record<CanvasId, CanvasNode>;
  allEdges: Record<string, CanvasEdge>;
  selectedNodeIds: CanvasId[];
  selectedEdgeIds: string[];
  selectedGroupIds: string[];
};

const MAX_HISTORY_LENGTH = 40;
const historySignal = createBlockSignal<Snapshot[]>([]);
const currentHistorySignal = createBlockSignal<Snapshot | undefined>(undefined);
const currentStateIndex = createBlockSignal<number>(-1);

export const useCanvasHistory = sharedInstance(createHistory);

function createHistory() {
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const selection = useSelection();
  const [history, setHistory] = historySignal;
  const [current, setCurrent] = currentHistorySignal;
  const [currentIndex, setCurrentIndex] = currentStateIndex;
  const [allNodes, setNodeStore] = nodesStore;
  const [allEdges, setEdgeStore] = edgesStore;
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
