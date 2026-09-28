import { type Tool, Tools } from '@block-canvas/constants';
import {
  type CanvasEdge,
  type CanvasEntityStyle,
  type CanvasGroup,
  type CanvasId,
  type CanvasNode,
  EdgeConnectionStyles,
} from '@block-canvas/model/CanvasModel';
import type { ItemType } from '@service-storage/client';
import type { LexicalEditor } from 'lexical';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ConnectOperation } from '../operation/connect';
import type { FileOperation } from '../operation/file';
import type { ImageOperation } from '../operation/image';
import type { MoveOperation } from '../operation/move';
import type { Operator } from '../operation/operation';
import type { PencilOperation } from '../operation/pencil';
import type { RescaleOperation } from '../operation/rescale';
import type { SelectOperation } from '../operation/select';
import type { ShapeOperation } from '../operation/shape';
import type { TextOperation } from '../operation/text';
import type { Snapshot } from '../signal/canvasHistory';
import type { RenderState } from '../store/RenderState';
import type { Rectangle } from '../util/rectangle';
import { getTailwindColor } from '../util/style';
import type { Vector2 } from '../util/vector2';

export type CanvasAnimationState = {
  startX: number;
  startY: number;
  startScale: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  startTime: number;
  duration: number;
  isAnimating: boolean;
};

export type CanvasContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  ref?: HTMLDivElement;
  mousePos?: { x: number; y: number };
};

const defaultStyle = (): CanvasEntityStyle => ({
  fillColor: getTailwindColor('neutral-100'),
  strokeColor: getTailwindColor('neutral-700'),
  strokeWidth: 2,
  cornerRadius: 0,
  opacity: 1,
  textSize: 16,
  connectionStyle: EdgeConnectionStyles.straight,
});

export function createCanvasDocumentState() {
  return {
    stores: {
      nodes: createStore<Record<CanvasId, CanvasNode>>({}),
      edges: createStore<Record<CanvasId, CanvasEdge>>({}),
      groups: createStore<Record<CanvasId, CanvasGroup>>({}),
      render: createStore<RenderState>({
        x: 0,
        y: 0,
        scale: 1,
        containerRect: undefined,
      }),
      animation: createStore<CanvasAnimationState>({
        startX: 0,
        startY: 0,
        startScale: 1,
        targetX: 0,
        targetY: 0,
        targetScale: 1,
        startTime: 0,
        duration: 0,
        isAnimating: false,
      }),
      cachedStyle: createStore<CanvasEntityStyle>(defaultStyle()),
      contextMenu: createStore<CanvasContextMenuState>({
        open: false,
        x: 0,
        y: 0,
      }),
      textNodeEditors: createStore<Record<string, LexicalEditor>>({}),
    },
    signals: {
      selectedNodeIds: createSignal<Set<string>>(new Set()),
      selectedEdgeIds: createSignal<Set<string>>(new Set()),
      selectedGroupIds: createSignal<Set<string>>(new Set()),
      selectionBox: createSignal<Rectangle>(),
      lastSelectedNodeIds: createSignal<Set<string>>(new Set()),
      lastSelectedEdgeIds: createSignal<Set<string>>(new Set()),
      history: createSignal<Snapshot[]>([]),
      currentHistory: createSignal<Snapshot>(),
      currentHistoryIndex: createSignal(-1),
      highestOrder: createSignal(0),
      lastCreatedNodeId: createSignal<CanvasId>(),
      pendingUpdates: createSignal(false),
      currentSavedFile: createSignal<Blob | null>(null),
      selectedTool: createSignal<Tool>(Tools.Grab),
      handlersByTool: createSignal<Map<Tool, Operator[]>>(new Map()),
      mouseDownPosition: createSignal<Vector2>(),
      mousePosition: createSignal<Vector2>(),
      lastMousePosition: createSignal<Vector2>(),
      rawMouseDownPosition: createSignal<Vector2>(),
      activeTextEditor: createSignal(false),
      middleMousePressed: createSignal<boolean>(),
      canvasDragging: createSignal(false),
      connectorTypeMenuTrigger: createSignal(false),
      currentConnectOperation: createSignal<ConnectOperation>(),
      currentShapeOperation: createSignal<ShapeOperation>(),
      currentRescaleOperation: createSignal<RescaleOperation>(),
      currentPencilOperation: createSignal<PencilOperation>(),
      currentTextOperation: createSignal<TextOperation>(),
      currentMoveOperation: createSignal<MoveOperation>(),
      selectedImage: createSignal<{
        type: 'image' | 'video';
        id: string;
      }>(),
      currentImageOperation: createSignal<ImageOperation>(),
      currentSelectOperation: createSignal<SelectOperation>(),
      selectedFile: createSignal<{
        type?: ItemType;
        id?: string;
      }>({}),
      currentFileOperation: createSignal<FileOperation>(),
    },
    instances: new Map<symbol, unknown>(),
  };
}

export type CanvasDocumentState = ReturnType<typeof createCanvasDocumentState>;
