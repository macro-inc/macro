import type {
  CanvasEdge,
  CanvasGroup,
  CanvasId,
  CanvasNode,
} from '@block-canvas/model/CanvasModel';
import { createBlockStore } from '@core/block';

/**
 * Reactive store for all node data on the canvas.
 */

export const nodesStore = createBlockStore<Record<CanvasId, CanvasNode>>({});
/**
 * Reactive store for all edge data on the canvas.
 */

export const edgesStore = createBlockStore<Record<CanvasId, CanvasEdge>>({});
/**
 * Reactive store for all group data on the canvas.
 */

export const groupStore = createBlockStore<Record<CanvasId, CanvasGroup>>({});
