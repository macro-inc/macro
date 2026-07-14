import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { batch, untrack } from 'solid-js';
import { OPERATION_LOGGING, Tools } from '../constants';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import { useCanvasEdges, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import { type Vector2, vec2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Move] ${message}`, 'color: violet');
}

export type MoveOperation = Operation & {
  type: 'move';
  initialMousePos: Vector2;
  nodePositions: Record<string, Vector2>;
  edgePositions: Record<string, { from?: Vector2; to?: Vector2 }>;
};

export const currentMoveOperationSignal = createBlockSignal<MoveOperation>();

export const useMove = sharedInstance((): Operator => {
  const [currentMoveOperation, setCurrentMoveOperation] =
    currentMoveOperationSignal;
  const { selectedNodes, selectedEdges } = useSelection();
  const { pageToCanvas } = useRenderState();
  const { updateNode, ...nodes } = useCanvasNodes();
  const { updateEdge, ...edges } = useCanvasEdges();
  const { setSelectedTool } = useToolManager();
  const history = useCanvasHistory();

  function applyMousePos(
    mousePos: Vector2,
    opts?: { autosave?: boolean; shiftKey?: boolean }
  ) {
    const op = currentMoveOperation();
    if (!op) return;

    let delta = mousePos.subtract(op.initialMousePos);

    if (opts?.shiftKey) {
      if (Math.abs(delta.x) > Math.abs(delta.y)) {
        delta.y = 0;
      } else if (Math.abs(delta.y) > Math.abs(delta.x)) {
        delta.x = 0;
      }
    }

    batch(() => {
      nodes.batchUpdate(() => {
        for (const [nodeId, nodePos] of Object.entries(op.nodePositions)) {
          updateNode(nodeId, {
            x: nodePos.x + delta.x,
            y: nodePos.y + delta.y,
          });
        }
      }, opts);

      edges.batchUpdate(() => {
        for (const [edgeId, edgePos] of Object.entries(op.edgePositions)) {
          const original = edges.get(edgeId);
          updateEdge(edgeId, {
            from: edgePos.from
              ? {
                  type: 'free',
                  x: edgePos.from.x + delta.x,
                  y: edgePos.from.y + delta.y,
                }
              : original.from,
            to: edgePos.to
              ? {
                  type: 'free',
                  x: edgePos.to.x + delta.x,
                  y: edgePos.to.y + delta.y,
                }
              : original.to,
          });
        }
      }, opts);
    });
  }

  return {
    reset() {
      _log('reset');
      setCurrentMoveOperation();
    },

    start(e: PointerEvent) {
      _log('start');
      if (
        untrack(selectedNodes).length === 0 &&
        untrack(selectedEdges).length === 0
      ) {
        return;
      }
      history.open();
      const nodePositions: Record<string, Vector2> = {};
      const edgePositions: Record<string, { from?: Vector2; to?: Vector2 }> =
        {};

      for (const node of untrack(selectedNodes)) {
        nodePositions[node.id] = vec2(node.x, node.y);
      }
      for (const edge of untrack(selectedEdges)) {
        edgePositions[edge.id] = {
          from:
            edge.from.type === 'free'
              ? vec2(edge.from.x, edge.from.y)
              : undefined,
          to: edge.to.type === 'free' ? vec2(edge.to.x, edge.to.y) : undefined,
        };
      }

      setCurrentMoveOperation({
        type: 'move',
        timeStamp: Date.now(),
        initialMousePos: pageToCanvas(e),
        nodePositions,
        edgePositions,
      });
    },

    commit(e: PointerEvent) {
      if (!currentMoveOperation()) return;
      _log('commit');
      const mousePos = pageToCanvas(e);

      applyMousePos(mousePos, {
        autosave: true,
        shiftKey: e.shiftKey,
      });

      setCurrentMoveOperation();
      history.close();
      setSelectedTool(Tools.Select);
    },

    abort() {
      const op = currentMoveOperation();
      if (!op) return;
      _log('abort');
      applyMousePos(op.initialMousePos, { autosave: true });
      setCurrentMoveOperation();
    },

    preview(e: PointerEvent) {
      if (!currentMoveOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      applyMousePos(mousePos, { shiftKey: e.shiftKey });
    },

    active() {
      const op = currentMoveOperation();
      return !!op;
    },
  };
});
