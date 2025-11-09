import { createBlockSignal } from '@core/block';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { pressedKeys } from 'core/hotkey/state';
import { batch, untrack } from 'solid-js';
import { type Anchor, OPERATION_LOGGING, Tools } from '../constants';
import {
  type CanvasEdge,
  type CanvasId,
  type CanvasNode,
  type FileNode,
  type ImageNode,
  isFileNode,
  isImageNode,
  isPencilNode,
  isShapeNode,
  isTextNode,
  isVideoNode,
  type PencilNode,
  type ShapeNode,
  type TextNode,
  type VideoNode,
} from '../model/CanvasModel';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import {
  useCanvasEdges,
  useCanvasNodes,
  useSaveCanvasData,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { Rect, type Rectangle } from '../util/rectangle';
import { sharedInstance } from '../util/sharedInstance';
import { Vec2, type Vector2, vec2 } from '../util/vector2';
import { fileHeight, fileWidth } from './file';
import type { Operator } from './operation';

function _log(message: string) {
  if (!OPERATION_LOGGING || !DEV_MODE_ENV) return;
  console.log(`%c[Rescale] ${message}`, 'color: orangered');
}

export type RescaleOperation = {
  initialBoundingRect: Rectangle;
  initialMousePos: Vector2;
  innerNodeRatioRects: Record<CanvasId, Rectangle>;
  innerEdgeRatioVects: Record<string, { from?: Vector2; to?: Vector2 }>;
  anchor: Anchor;
  initialFlip: Record<CanvasId, Vector2>;
  proportionalDefault: boolean;
};

export const currentRescaleOperationSignal =
  createBlockSignal<RescaleOperation>();

type CoordTuple = [number, number];

type RescaleNodeFunction<T extends CanvasNode> = (
  nodes: ReturnType<typeof useCanvasNodes>,
  node: T,
  innerRect: Rectangle,
  normalized?: boolean,
  flip?: Vector2
) => void;

const rescalePencil: RescaleNodeFunction<PencilNode> = (
  nodes,
  node,
  innerRect,
  normalized
) => {
  if (normalized) {
    const newCoords = node.coords.map((coord: CoordTuple) => [
      coord[0] * (innerRect.w / node.width) +
        (innerRect.w < 0 ? -innerRect.w : 0),
      coord[1] * (innerRect.h / node.height) +
        (innerRect.h < 0 ? -innerRect.h : 0),
    ]) as CoordTuple[];
    nodes.updateNode(node.id, {
      x: Math.min(innerRect.x, innerRect.x + innerRect.w),
      y: Math.min(innerRect.y, innerRect.y + innerRect.h),
      wScale: 1,
      hScale: 1,
      width: Math.abs(innerRect.w),
      height: Math.abs(innerRect.h),
      coords: newCoords,
    });
    return;
  }
  nodes.updateNode(node.id, {
    x: innerRect.x,
    y: innerRect.y,
    wScale: innerRect.w / node.width,
    hScale: innerRect.h / node.height,
  });
};

const rescaleShape: RescaleNodeFunction<ShapeNode> = (
  nodes,
  node,
  innerRect
) => {
  nodes.updateNode(node.id, {
    x: Math.min(innerRect.x, innerRect.x + innerRect.w),
    y: Math.min(innerRect.y, innerRect.y + innerRect.h),
    width: Math.abs(innerRect.w),
    height: Math.abs(innerRect.h),
  });
};

const rescaleFile: RescaleNodeFunction<FileNode> = (nodes, node, innerRect) => {
  const ratio = fileWidth / fileHeight;
  const largerWidth = Math.abs(innerRect.w) / Math.abs(innerRect.h) > ratio;
  nodes.updateNode(node.id, {
    x: Math.min(innerRect.x, innerRect.x + innerRect.w),
    y: Math.min(innerRect.y, innerRect.y + innerRect.h),
    width: largerWidth ? Math.abs(innerRect.w) : ratio * Math.abs(innerRect.h),
    height: !largerWidth
      ? Math.abs(innerRect.h)
      : Math.abs(innerRect.w) / ratio,
  });
};

const rescaleMediaNode: RescaleNodeFunction<ImageNode | VideoNode> = (
  nodes,
  node,
  innerRect,
  _normalized,
  initialFlip
) => {
  let flipX = false;
  let flipY = false;
  if (initialFlip !== undefined) {
    flipX = initialFlip.x * Math.sign(innerRect.w) < 0;
    flipY = initialFlip.y * Math.sign(innerRect.h) < 0;
  }
  nodes.updateNode(node.id, {
    x: Math.min(innerRect.x, innerRect.x + innerRect.w),
    y: Math.min(innerRect.y, innerRect.y + innerRect.h),
    width: Math.abs(innerRect.w),
    height: Math.abs(innerRect.h),
    flipX: flipX,
    flipY: flipY,
  });
};

// Do not upddate the height of the text node. The is a resize observer on the
// componnent that will handle setting rect height based on the text wrapping.
const rescaleText: RescaleNodeFunction<TextNode> = (nodes, node, innerRect) => {
  nodes.updateNode(node.id, {
    x: Math.min(innerRect.x, innerRect.x + innerRect.w),
    y: Math.min(innerRect.y, innerRect.y + innerRect.h),
  });

  // If node does not have pending width, then we can rescale it.
  if (node.followTextWidth) return;

  nodes.updateNode(node.id, {
    width: Math.max(Math.abs(innerRect.w), 50),
  });
};

const rescaleEdge = (
  edges: ReturnType<typeof useCanvasEdges>,
  edge: CanvasEdge,
  innerRect: Rectangle,
  innerVects: { from?: Vector2; to?: Vector2 }
) => {
  if (innerVects.from !== undefined) {
    const v = Vec2.applyRatioVect(innerVects.from, innerRect);
    edges.updateEdge(edge.id, {
      from: {
        type: 'free',
        x: v.x,
        y: v.y,
      },
    });
  }
  if (innerVects.to !== undefined) {
    const v = Vec2.applyRatioVect(innerVects.to, innerRect);
    edges.updateEdge(edge.id, {
      to: {
        type: 'free',
        x: v.x,
        y: v.y,
      },
    });
  }
};

export const useRescale = sharedInstance((): Operator => {
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const { selectedNodes, selectedEdges, selectionBounds } = useSelection();
  const { pageToCanvas } = useRenderState();
  const { setSelectedTool } = useToolManager();
  const history = useCanvasHistory();
  const [currentRescaleOperation, setCurrentRescaleOperation] =
    currentRescaleOperationSignal;
  const saveCanvasData = useSaveCanvasData();

  function applyMousePos(mousePos: Vector2, normalize?: boolean) {
    const op = currentRescaleOperation();
    if (!op) return;

    const proportional = op.proportionalDefault !== pressedKeys().has('shift');

    const centered = pressedKeys().has('opt');

    const scaledOuterRect = Rect.rescaleFromAnchorToPoint(
      op.initialBoundingRect,
      op.anchor,
      mousePos,
      proportional,
      centered
    );

    batch(() => {
      for (const [nodeId, ratio] of Object.entries(op.innerNodeRatioRects)) {
        const newInnerRect = Rect.applyRatioRectangle(ratio, scaledOuterRect);
        const node = nodes.get(nodeId);
        if (isPencilNode(node)) {
          rescalePencil(nodes, node, newInnerRect, normalize);
        } else if (isShapeNode(node)) {
          rescaleShape(nodes, node, newInnerRect);
        } else if (isImageNode(node)) {
          const flip = op.initialFlip[node.id];
          rescaleMediaNode(nodes, node, newInnerRect, undefined, flip);
        } else if (isTextNode(node)) {
          rescaleText(nodes, node, newInnerRect);
        } else if (isFileNode(node)) {
          rescaleFile(nodes, node, newInnerRect);
        } else if (isVideoNode(node)) {
          const flip = op.initialFlip[node.id];
          rescaleMediaNode(nodes, node, newInnerRect, undefined, flip);
        }
      }
      for (const [edgeId, ratio] of Object.entries(op.innerEdgeRatioVects)) {
        const edge = edges.get(edgeId);
        rescaleEdge(edges, edge, scaledOuterRect, ratio);
      }
    });
  }

  return {
    reset() {
      _log('reset');
      setCurrentRescaleOperation();
      setSelectedTool(Tools.Select);
    },

    active() {
      const op = currentRescaleOperation();
      return !!op;
    },

    start(e: PointerEvent, anchor: Anchor) {
      _log('start');
      const initialBoundingRect = untrack(selectionBounds)?.clone();
      if (!initialBoundingRect) return;

      if (
        untrack(selectedNodes).length === 0 &&
        untrack(selectedEdges).length === 0
      )
        return;

      history.open();

      const innerNodeRatioRects: Record<string, Rectangle> = {};
      const innerEdgeRatioVects: Record<
        string,
        { from: Vector2 | undefined; to: Vector2 | undefined }
      > = {};
      const initialFlip: Record<string, Vector2> = {};

      for (const node of untrack(selectedNodes)) {
        const nodeRect = Rect.fromCanvasNode(node);
        innerNodeRatioRects[node.id] = Rect.calculateRatioRectangle(
          nodeRect,
          initialBoundingRect
        );
        if (isImageNode(node)) {
          initialFlip[node.id] = vec2(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
        }
      }

      for (const edge of untrack(selectedEdges)) {
        innerEdgeRatioVects[edge.id] = Vec2.calculateRatioVect(
          edge,
          initialBoundingRect
        );
      }

      const mediaOnly = selectedNodes().every(
        (node) => isImageNode(node) || isVideoNode(node)
      );

      setCurrentRescaleOperation({
        type: 'rescale',
        timeStamp: Date.now(),
        initialMousePos: pageToCanvas(e),
        initialBoundingRect,
        innerNodeRatioRects,
        innerEdgeRatioVects,
        anchor,
        initialFlip,
        proportionalDefault: mediaOnly,
      });
    },

    commit(e: PointerEvent) {
      const op = currentRescaleOperation();
      if (!op) return;
      _log('commit');
      history.close();
      const mousePos = pageToCanvas(e);
      applyMousePos(mousePos, true);
      setCurrentRescaleOperation();
      setSelectedTool(Tools.Select);
      saveCanvasData();
    },

    preview(e: PointerEvent) {
      if (!currentRescaleOperation()) return;
      _log('preview');
      const mousePos = pageToCanvas(e);
      applyMousePos(mousePos);
    },

    abort() {
      _log('abort');
      const op = currentRescaleOperation();
      if (!op) return;
      applyMousePos(op.initialMousePos);
      setCurrentRescaleOperation();
    },
  };
});
