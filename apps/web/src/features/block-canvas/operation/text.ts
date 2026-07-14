import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { batch } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { OPERATION_LOGGING } from '../constants';
import type { TextNode } from '../model/CanvasModel';
import { useCachedStyle } from '../signal/cachedStyle';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import type { Vector2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Text] ${message}`, 'color: peru');
}

export type TextOperation = Operation & {
  type: 'text';
  initialMousePos: Vector2;
  node: TextNode;
};

export const currentTextOperationSignal = createBlockSignal<TextOperation>();

export const useText = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { createNode, updateNode, ...nodes } = useCanvasNodes();
  const { deselectNode } = useSelection();
  const [currentTextOperation, setCurrentTextOperation] =
    currentTextOperationSignal;
  const history = useCanvasHistory();
  const cachedStyle = useCachedStyle();
  const highestOrder = highestOrderSignal.get;

  function _applyMousePos(mousePos: Vector2, normalize?: boolean) {
    const op = currentTextOperation();
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
        },
        { preview: true }
      );
    } else {
      updateNode(
        op.node.id,
        {
          width: mousePos.x - op.initialMousePos.x,
        },
        { preview: true }
      );
    }
  }

  return {
    reset() {
      _log('reset');
      setCurrentTextOperation();
      nodes.clearPreview();
    },

    start(e: PointerEvent) {
      _log('start');
      history.open();
      const mousePos = pageToCanvas(e);
      const fontSize = cachedStyle.getStyle().fontSize ?? 24;

      const node = createNode(
        {
          type: 'text',
          x: mousePos.x,
          y: mousePos.y,
          width: 0,
          height: 2.25 * fontSize,
          edges: [],
          style: cachedStyle.getStyle(),
          text: '',
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        {
          preview: true,
        }
      ) as TextNode;

      setCurrentTextOperation({
        type: 'text',
        timeStamp: Date.now(),
        initialMousePos: mousePos,
        node,
      });
    },

    commit(e: PointerEvent) {
      const op = currentTextOperation();
      if (!op) return;
      _log('commit');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos, true);
      const { id: _, ...newNode } = structuredClone(unwrap(op.node));

      // If the drag was small, then make follow text node.
      if (newNode.width < 10) {
        newNode.followTextWidth = true;
      }

      batch(() => {
        const { id: newId } = createNode(newNode, { autosave: true });
        setCurrentTextOperation();
        nodes.clearPreview();
        history.close();
        nodes.setLastCreated(newId);
      });
    },

    abort() {
      const op = currentTextOperation();
      if (!op) return;
      _log('abort');
      setCurrentTextOperation();
      deselectNode(op.node.id);
      nodes.clearPreview();
    },

    preview(e: PointerEvent) {
      if (!currentTextOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
    },

    active() {
      const op = currentTextOperation();
      return !!op;
    },
  };
});
