import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { copiedItem } from '@core/state/clipboard';
import { unwrap } from 'solid-js/store';
import { OPERATION_LOGGING, Tools } from '../constants';
import type { ImageNode, VideoNode } from '../model/CanvasModel';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useToolManager } from '../signal/toolManager';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import type { Vector2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

export const selectedImageSignal = createBlockSignal<{
  type: 'image' | 'video';
  id: string;
}>();
const minSize = 1;

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Image] ${message}`, 'color: peru');
}

export type ImageOperation = Operation & {
  type: 'image';
  initialMousePos: Vector2;
  node: ImageNode | VideoNode;
};

export const currentImageOperationSignal = createBlockSignal<ImageOperation>();

export const useImage = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { createNode, updateNode, ...nodes } = useCanvasNodes();
  const [currentImageOperation, setCurrentImageOperation] =
    currentImageOperationSignal;
  const { setSelectedTool } = useToolManager();
  const history = useCanvasHistory();
  const highestOrder = highestOrderSignal.get;

  const selectedImage = selectedImageSignal.get;
  const setSelectedImage = selectedImageSignal.set;

  function _applyMousePos(mousePos: Vector2) {
    const op = currentImageOperation();
    if (!op) return;
    const calculatedWidth = mousePos.x - op.initialMousePos.x;
    const calculatedHeight = mousePos.y - op.initialMousePos.y;
    updateNode(
      op.node.id,
      {
        x: Math.min(mousePos.x, op.initialMousePos.x),
        y: Math.min(mousePos.y, op.initialMousePos.y),
        width: calculatedWidth === 0 ? -1 : Math.abs(calculatedWidth),
        height: calculatedHeight === 0 ? -1 : Math.abs(calculatedHeight),
        flipX: mousePos.x < op.initialMousePos.x,
        flipY: mousePos.y < op.initialMousePos.y,
      },
      { preview: true }
    );
  }

  return {
    reset() {
      _log('reset');
      setCurrentImageOperation();
      nodes.clearPreview();
    },

    start(e: PointerEvent) {
      _log('start');
      history.open();
      const mousePos = pageToCanvas(e);
      let idToCreate = selectedImage()?.id;
      if (!idToCreate) {
        if (copiedItem()) {
          idToCreate = copiedItem()!.id;
        } else {
          console.warn('No source image found');
          return;
        }
      }

      const node = createNode(
        {
          type: selectedImage()?.type ?? 'image',
          uuid: idToCreate,
          x: mousePos.x,
          y: mousePos.y,
          width: -1,
          height: -1,
          edges: [],
          style: { strokeColor: 'transparent', strokeWidth: 0 },
          flipX: false,
          flipY: false,
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        { preview: true }
      ) as ImageNode;

      setCurrentImageOperation({
        type: 'image',
        timeStamp: Date.now(),
        initialMousePos: mousePos,
        node,
      });
    },

    commit(e: PointerEvent) {
      const op = currentImageOperation();
      if (!op) return;
      _log('commit');
      history.close();
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
      const { id: _, ...newNode } = structuredClone(unwrap(op.node));

      if (newNode.width <= minSize || newNode.height <= minSize) {
        newNode.width = 0;
        newNode.height = 0;
      }

      createNode(newNode, { autosave: true });

      setCurrentImageOperation();
      nodes.clearPreview();

      setSelectedTool(Tools.Select);
      setSelectedImage();
    },

    abort() {
      _log('abort');
      setCurrentImageOperation();
      // deselectAll();
      nodes.clearPreview();
    },

    preview(e: PointerEvent) {
      if (!currentImageOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
    },

    active() {
      const op = currentImageOperation();
      return !!op;
    },
  };
});
