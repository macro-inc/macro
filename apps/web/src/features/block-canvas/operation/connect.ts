import { useToolManager } from '@block-canvas/signal/toolManager';
import {
  degreesToRadians,
  radiansToDegrees,
  snapTo,
} from '@block-canvas/util/math';
import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { unwrap } from 'solid-js/store';
import type { Edge } from '../constants';
import { OPERATION_LOGGING, Tools } from '../constants';
import type {
  CanvasEdge,
  CanvasId,
  ConnectedEnd,
  FreeEnd,
} from '../model/CanvasModel';
import { useCachedStyle } from '../signal/cachedStyle';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import {
  highestOrderSignal,
  useCanvasEdges,
  useEdgeUtils,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import { type Vector2, vec2 } from '../util/vector2';
import type { Operation } from './operation';

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Connect] ${message}`, 'color: teal');
}

export type NodeConnectionInfo = {
  node: CanvasId;
  side: Edge;
};

export type LineEditInfo = {
  edge: CanvasEdge;
  handle: 'from' | 'to';
};

/**
 * Represents a connection operation between nodes in a canvas.
 * The connect operation is fairly tricky.
 * @extends {Operation}
 * @property {string} type - Must be 'connect' to identify this operation type
 * @property {NodeConnectionInfo | Vector2} start - Starting point of the connection, either a node connection or coordinates
 * @property {Vector2} currentMousePos - Current position of the mouse during the operation
 * @property {CanvasEdge} edge - The edge being created or modified. Will be a previe edge if edge is being created or a "regular" edge if
 *     the edges if being edited from existing.
 * @property {NodeConnectionInfo | Vector2} end - Ending point of the connection, either a node connection or coordinates
 * @property {'from' | 'to'} handle - Specifies which end of the connection is being manipulated. When you edito an existing edge,
 *     you can grab it by either the from or the to side, so we track which one is being manipulated.
 * @property {NodeConnectionInfo} [dropTarget] - Optional target node information when hovering over a valid connection point, like
 *     the edge of a shape
 * @property {true} [editExisting] - Optional flag indicating if this is modifying an existing connection
 */
export type ConnectOperation = Operation & {
  type: 'connect';
  start: NodeConnectionInfo | Vector2;
  currentMousePos: Vector2;
  edge: CanvasEdge;
  end: NodeConnectionInfo | Vector2;
  handle: 'from' | 'to';
  dropTarget?: NodeConnectionInfo;
  editExisting?: true;
};

export const currentConnectOperationSignal =
  createBlockSignal<ConnectOperation>();

function freeEnd(x: number, y: number): FreeEnd {
  return {
    type: 'free',
    x,
    y,
  };
}

function connectedEnd(id: string, side: Edge): ConnectedEnd {
  return {
    type: 'connected',
    node: id,
    side: side,
  };
}

export type ConnectOperator = ReturnType<typeof useConnect>;

export const useConnect = sharedInstance(() => {
  const [currentConnectOperation, setCurrentConnectOperation] =
    currentConnectOperationSignal;
  const edges = useCanvasEdges();
  const { selectEdge, deselectAll } = useSelection();
  const { clientToCanvas } = useRenderState();
  const history = useCanvasHistory();
  const cachedStyle = useCachedStyle();
  const highestOrder = highestOrderSignal.get;
  const { setSelectedTool } = useToolManager();
  const edgeUtils = useEdgeUtils();

  const snap = (edge: CanvasEdge, handle: 'from' | 'to', mousePos: Vector2) => {
    const endpoints = edgeUtils.getRawEndPoints(edge);
    const other = handle === 'from' ? 'to' : 'from';
    const otherEnd = endpoints[other];
    const delta = mousePos.subtract(otherEnd);
    let angle = snapTo(radiansToDegrees(Math.atan2(delta.y, delta.x)), 45);
    const newDelta = vec2(
      Math.cos(degreesToRadians(angle)) * delta.mag(),
      Math.sin(degreesToRadians(angle)) * delta.mag()
    );
    const newEnd = otherEnd.add(newDelta);
    return newEnd;
  };

  function applyMousePos(mousePos: Vector2, opts: { shiftKey?: boolean }) {
    const op = currentConnectOperation();
    if (!op) return;
    op.currentMousePos = mousePos;

    if (!opts.shiftKey) {
      edges.updateEdge(op.edge.id, {
        [op.handle]: freeEnd(mousePos.x, mousePos.y),
      });
      return;
    }
    const newEnd = snap(op.edge, op.handle, mousePos);

    edges.updateEdge(op.edge.id, {
      [op.handle]: freeEnd(newEnd.x, newEnd.y),
    });
  }

  return {
    reset() {
      setCurrentConnectOperation();
      edges.clearPreview();
    },

    start(e: PointerEvent, target?: NodeConnectionInfo | LineEditInfo) {
      _log('start');
      const current = currentConnectOperation();
      if (current) setCurrentConnectOperation();
      const mousePos = clientToCanvas({ clientX: e.pageX, clientY: e.pageY });
      history.open();

      // No target means a doubly free edge.
      if (target === undefined) {
        const edge = edges.createEdge(
          {
            from: freeEnd(mousePos.x, mousePos.y),
            to: freeEnd(mousePos.x, mousePos.y),
            style: cachedStyle.getStyle(),
            layer: 0,
            sortOrder: highestOrder() + 1,
          },
          { preview: true }
        );

        setCurrentConnectOperation({
          type: 'connect',
          currentMousePos: mousePos,
          timeStamp: Date.now(),
          edge,
          start: vec2(mousePos.x, mousePos.y),
          end: vec2(mousePos.x, mousePos.y),
          handle: 'to',
        });

        return;
      }

      // We are starting a line from the egde of a node.
      if ('node' in target) {
        const t = target as NodeConnectionInfo;
        const edge = edges.createEdge(
          {
            from: connectedEnd(t.node, t.side),
            to: freeEnd(mousePos.x, mousePos.y),
            style: cachedStyle.getStyle(),
            layer: 0,
            sortOrder: highestOrder() + 1,
          },
          { preview: true }
        );

        setCurrentConnectOperation({
          type: 'connect',
          timeStamp: Date.now(),
          currentMousePos: mousePos,
          edge,
          start: t,
          end: vec2(mousePos.x, mousePos.y),
          handle: 'to',
        });
      }

      // We grabbed a handle and are updateing and exisiting line
      if ('handle' in target) {
        const t = target as LineEditInfo;
        const edge = edges.get(t.edge.id);
        if (!edge) return;
        setCurrentConnectOperation({
          type: 'connect',
          timeStamp: Date.now(),
          currentMousePos: mousePos,
          edge,
          start:
            edge.from.type === 'free'
              ? vec2(edge.from.x, edge.from.y)
              : connectedEnd(edge.from.node, edge.from.side),
          end:
            edge.to.type === 'free'
              ? vec2(edge.to.x, edge.to.y)
              : connectedEnd(edge.to.node, edge.to.side),
          handle: t.handle,
          editExisting: true,
        });
      }
    },

    commit(e: PointerEvent) {
      const op = currentConnectOperation();
      if (!op) return;
      _log('commit');

      const mousePos = clientToCanvas(e);

      let edge: CanvasEdge;

      let newEnd = vec2(mousePos.x, mousePos.y);
      if (e.shiftKey) {
        newEnd = snap(op.edge, op.handle, mousePos);
      }

      if (op.editExisting) {
        edge = op.edge;
      } else {
        // convert the preview edge to a real edge.
        edge = edges.createEdge(
          {
            id: op.edge.id,
            style: { ...(unwrap(op.edge.style) || {}) },
            from: { ...unwrap(op.edge.from) },
            to: freeEnd(newEnd.x, newEnd.y),
            layer: 0,
            sortOrder: highestOrder() + 1,
          },
          { autosave: true }
        );
      }

      // apply the drop target.
      if (op.dropTarget) {
        edges.updateEdge(edge.id, {
          [op.handle]: connectedEnd(op.dropTarget.node, op.dropTarget.side),
        });
      }

      setCurrentConnectOperation();
      edges.clearPreview();

      deselectAll();
      selectEdge(edge.id);
      history.close();

      setSelectedTool(Tools.Select);
    },

    abort() {
      const op = currentConnectOperation();
      if (!op) return;
      _log('abort');
      setCurrentConnectOperation();
      edges.clearPreview();
    },

    preview(e: PointerEvent) {
      const op = currentConnectOperation();
      if (!op) return;
      _log('preview');
      const mousePos = clientToCanvas(e);
      applyMousePos(mousePos, { shiftKey: e.shiftKey });
    },

    active() {
      const op = currentConnectOperation();
      return !!op;
    },

    setDropTarget(info?: NodeConnectionInfo) {
      const op = currentConnectOperation();
      if (!op) return;
      setCurrentConnectOperation({
        ...op,
        dropTarget: info,
      });
    },
  };
});
