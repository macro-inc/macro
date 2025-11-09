import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { unwrap } from 'solid-js/store';
import { OPERATION_LOGGING, Tools } from '../constants';
import type { ShapeNode } from '../model/CanvasModel';
import { useCachedStyle } from '../signal/cachedStyle';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import type { Vector2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

const minSize = 10;

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Shape] ${message}`, 'color: goldenrod');
}

export type ShapeOperation = Operation & {
  type: 'shape';
  initialMousePos: Vector2;
  node: ShapeNode;
};

export const currentShapeOperationSignal = createBlockSignal<ShapeOperation>();

export const useShape = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { createNode, updateNode, ...nodes } = useCanvasNodes();
  const { deselectAll, deselectNode } = useSelection();
  const [currentShapeOperation, setCurrentShapeOperation] =
    currentShapeOperationSignal;
  const history = useCanvasHistory();
  const cachedStyle = useCachedStyle();
  const { setSelectedTool } = useToolManager();
  const highestOrder = highestOrderSignal.get;

  function _applyMousePos(mousePos: Vector2, normalize?: boolean) {
    const op = currentShapeOperation();
    if (!op) return;
    if (normalize) {
      const calculatedWidth = mousePos.x - op.initialMousePos.x;
      const calculatedHeight = mousePos.y - op.initialMousePos.y;
      updateNode(
        op.node.id,
        {
          x: Math.min(op.node.x, op.node.x + calculatedWidth),
          y: Math.min(op.node.y, op.node.y + calculatedHeight),
          width: Math.abs(calculatedWidth),
          height: Math.abs(calculatedHeight),
        },
        { preview: true }
      );
    } else {
      updateNode(
        op.node.id,
        {
          width: mousePos.x - op.initialMousePos.x,
          height: mousePos.y - op.initialMousePos.y,
        },
        { preview: true }
      );
    }
  }

  return {
    reset() {
      _log('reset');
      setCurrentShapeOperation();
      nodes.clearPreview();
    },

    start(e: PointerEvent) {
      _log('start');
      history.open();
      const mousePos = pageToCanvas(e);
      const node = createNode(
        {
          type: 'shape',
          shape: 'rectangle',
          x: mousePos.x,
          y: mousePos.y,
          width: 0,
          height: 0,
          edges: [],
          style: cachedStyle.getStyle(),
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        { preview: true }
      ) as ShapeNode;

      setCurrentShapeOperation({
        type: 'shape',
        timeStamp: Date.now(),
        initialMousePos: mousePos,
        node,
      });
    },

    commit(e: PointerEvent) {
      const op = currentShapeOperation();
      if (!op) return;
      _log('commit');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos, true);
      const { id, ...newNode } = structuredClone(unwrap(op.node));

      if (newNode.width < minSize || newNode.height < minSize) {
        nodes.delete(id);
        setCurrentShapeOperation();
        nodes.clearPreview();
        deselectAll();
        return;
      }

      createNode(newNode, { autosave: true });

      setCurrentShapeOperation();
      nodes.clearPreview();

      history.close();

      setSelectedTool(Tools.Select);
    },

    abort() {
      const op = currentShapeOperation();
      if (!op) return;
      _log('abort');
      setCurrentShapeOperation();
      deselectNode(op.node.id);
      nodes.clearPreview();
    },

    preview(e: PointerEvent) {
      if (!currentShapeOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
    },

    active() {
      const op = currentShapeOperation();
      return !!op;
    },
  };
});
