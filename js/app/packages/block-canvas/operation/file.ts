import { createBlockSignal, useBlockId } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { trackMention } from '@core/signal/mention';
import { copiedItem } from '@core/state/clipboard';
import type { ItemType } from '@service-storage/client';
import { unwrap } from 'solid-js/store';
import { OPERATION_LOGGING, Tools } from '../constants';
import type { FileNode } from '../model/CanvasModel';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useToolManager } from '../signal/toolManager';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import type { Vector2 } from '../util/vector2';
import type { Operation, Operator } from './operation';

export const selectedFileSignal = createBlockSignal<{
  type?: ItemType;
  id?: string;
}>({
  type: undefined,
  id: undefined,
});

export const fileWidth = 250;
export const fileHeight = 50;

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[File] ${message}`, 'color: peru');
}

export type FileOperation = Operation & {
  type: 'file';
  initialMousePos: Vector2;
  node: FileNode;
};

export const currentFileOperationSignal = createBlockSignal<FileOperation>();

export const useFile = sharedInstance((): Operator => {
  const { pageToCanvas } = useRenderState();
  const { createNode, updateNode, ...nodes } = useCanvasNodes();
  const [currentFileOperation, setCurrentFileOperation] =
    currentFileOperationSignal;
  const { setSelectedTool } = useToolManager();
  const history = useCanvasHistory();
  const highestOrder = highestOrderSignal.get;
  const blockId = useBlockId();

  const selectedFile = selectedFileSignal.get;
  const setSelectedFile = selectedFileSignal.set;

  function _applyMousePos(mousePos: Vector2) {
    const op = currentFileOperation();
    if (!op) return;
    updateNode(
      op.node.id,
      {
        x: mousePos.x - fileWidth / 2,
        y: mousePos.y - fileHeight / 2,
        width: fileWidth,
        height: fileHeight,
      },
      { preview: true }
    );
  }

  return {
    reset() {
      _log('reset');
      setCurrentFileOperation();
      nodes.clearPreview();
    },

    start(e: PointerEvent) {
      _log('start');
      history.open();
      const mousePos = pageToCanvas(e);
      let { id, type } = selectedFile();
      if (!id) {
        if (copiedItem()) {
          id = copiedItem()!.id;
          type = copiedItem()!.type;
        } else {
          console.warn('No source File found');
          return;
        }
      }
      const node = createNode(
        {
          type: 'file',
          file: id,
          isChat: type === 'chat',
          x: mousePos.x - fileWidth / 2,
          y: mousePos.y - fileHeight / 2,
          width: fileWidth,
          height: fileHeight,
          edges: [],
          style: { strokeColor: 'transparent' },
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        { preview: true }
      ) as FileNode;

      setCurrentFileOperation({
        type: 'file',
        timeStamp: Date.now(),
        initialMousePos: mousePos,
        node,
      });
    },

    async commit(e: PointerEvent) {
      const op = currentFileOperation();
      if (!op) return;
      _log('commit');
      history.close();
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
      const { id: _, ...newNode } = structuredClone(unwrap(op.node));

      // Track document mention and store the UUID
      let mentionUuid: string | undefined;
      if (blockId && op.node.file && !op.node.isChat && !op.node.isRss) {
        mentionUuid = await trackMention(blockId, 'document', op.node.file);
      }

      createNode({ ...newNode, mentionUuid }, { autosave: true });

      setCurrentFileOperation();
      nodes.clearPreview();

      setSelectedTool(Tools.Select);
      setSelectedFile({
        type: undefined,
        id: undefined,
      });
    },

    abort() {
      _log('abort');
      setCurrentFileOperation();
      nodes.clearPreview();
    },

    preview(e: PointerEvent) {
      if (!currentFileOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      _applyMousePos(mousePos);
    },

    active() {
      const op = currentFileOperation();
      return !!op;
    },
  };
});
