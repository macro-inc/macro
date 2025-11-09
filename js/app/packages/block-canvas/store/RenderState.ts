import { MAX_ZOOM, MIN_ZOOM } from '@block-canvas/constants';
import { sharedInstance } from '@block-canvas/util/sharedInstance';
import {
  type BlockStore,
  createBlockEffect,
  createBlockMemo,
  createBlockStore,
  useBlockId,
  useIsNestedBlock,
} from '@core/block';
import { storageServiceClient } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { createEffect, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { clamp, easeInOutCubic } from '../util/math';
import { Rect } from '../util/rectangle';
import { vec2 } from '../util/vector2';

export type RenderState = {
  x: number;
  y: number;
  scale: number;
  containerRect: DOMRect | undefined;
};

export const defaultRenderState = (): RenderState => ({
  x: 0,
  y: 0,
  scale: 1,
  containerRect: undefined,
});

export const renderStateStore: BlockStore<RenderState> = createBlockStore(
  defaultRenderState()
);

type AnimationState = {
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

// Create a block store for animation state
const animationStore = createBlockStore<AnimationState>({
  startX: 0,
  startY: 0,
  startScale: 1,
  targetX: 0,
  targetY: 0,
  targetScale: 1,
  startTime: 0,
  duration: 0,
  isAnimating: false,
});

export const isAnimating = createBlockMemo(
  () => animationStore.get.isAnimating
);

// Create block effect for animation handling
createBlockEffect(() => {
  const [animation, setAnimation] = animationStore;
  const [, setState] = renderStateStore;
  if (!animation.isAnimating) return;

  const animate = () => {
    const now = performance.now();
    const elapsed = now - animation.startTime;
    const progress = Math.min(elapsed / animation.duration, 1);

    // Apply easing
    // const t = easeInOutCubic(progress);
    const t = easeInOutCubic(progress);

    // Interpolate values
    const x = animation.startX + (animation.targetX - animation.startX) * t;
    const y = animation.startY + (animation.targetY - animation.startY) * t;
    const scale =
      animation.startScale + (animation.targetScale - animation.startScale) * t;

    setState({ x, y, scale });

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      setAnimation('isAnimating', false);
    }
  };

  requestAnimationFrame(animate);
});

/**
 * Modify and read the canvas's render state from a block-scoped closure
 * (usually the top level of a component or a createCallback called from the top
 * level of a component).
 */
export const useRenderState = sharedInstance(() => {
  const [state, setState] = renderStateStore;
  const [, setAnimation] = animationStore;
  const blockId = useBlockId();
  const isNestedBlock = useIsNestedBlock();

  const debouncedSaveState = debounce(() => {
    if (isNestedBlock) return;
    saveState(blockId, unwrap(state));
  }, 500);

  const [defferedScale, setDeferredScale] = createSignal(state.scale);
  const debouncedSetDeferredScale = debounce(setDeferredScale, 20);
  createEffect(() => {
    debouncedSetDeferredScale(state.scale);
  });

  return {
    /**
     * Convert a clientX and clientY to a canvasX and canvasY. This
     * reads the current renderer sate and container rect with a non-reactive
     * unwrap.
     */
    clientToCanvas: createCallback(
      ({ clientX, clientY }: { clientX: number; clientY: number }) => {
        const { x, y, scale, containerRect } = unwrap(state);
        if (!containerRect) return vec2(clientX, clientY);
        return vec2(
          (clientX - containerRect.left - containerRect.width / 2 - x) / scale,
          (clientY - containerRect.top - containerRect.height / 2 - y) / scale
        );
      }
    ),

    pageToCanvas: createCallback(
      ({ pageX, pageY }: { pageX: number; pageY: number }) => {
        const { x, y, scale, containerRect } = unwrap(state);
        if (!containerRect) return vec2(pageX, pageY);
        return vec2(
          (pageX - containerRect.left - containerRect.width / 2 - x) / scale,
          (pageY - containerRect.top - containerRect.height / 2 - y) / scale
        );
      }
    ),

    /**
     * Zoom the canvas.
     * @param intensity - The amount to zoom. 0.1 is a 10% zoom.
     * @param direction - 'in' | 'out'
     * @param withMouse - If the zoom should be focused on the cursor position
     *     pass an object with a clientX and clientY (i.e. a mouseEvent).
     */
    zoom: createCallback(
      (
        amount: number,
        withMouse?: { clientX: number; clientY: number },
        savePos?: boolean
      ) => {
        if (isNaN(amount)) return;
        setAnimation('isAnimating', false);
        const { scale, x, y, containerRect } = unwrap(state);
        if (!containerRect) return;
        if (
          (scale === MIN_ZOOM && amount < 0) ||
          (scale === MAX_ZOOM && amount > 0)
        ) {
          return;
        }
        const delta = 1 + amount;
        const rect = containerRect;

        // Zoom towards mouseEvent or container center if undefined.
        let { clientX, clientY } = withMouse ?? {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };

        const mouseX = clientX - rect.left - rect.width / 2;
        const mouseY = clientY - rect.top - rect.height / 2;

        const canvasPointX = (mouseX - x) / scale;
        const canvasPointY = (mouseY - y) / scale;
        const newScale = clamp(scale * delta, MIN_ZOOM, MAX_ZOOM);

        setState({
          x: mouseX - canvasPointX * newScale,
          y: mouseY - canvasPointY * newScale,
          scale: newScale,
        });

        if (savePos) debouncedSaveState();
      }
    ),

    zoomTo: createCallback((scale: number, savePos?: boolean) => {
      if (isNaN(scale)) return;
      const { x, y, containerRect } = unwrap(state);
      if (!containerRect) return;
      if (scale <= MIN_ZOOM || scale >= MAX_ZOOM) {
        return;
      } else {
        setState({
          x,
          y,
          scale,
        });
      }

      if (savePos) debouncedSaveState();
    }),

    /**
     * Pan the cannvas with a movementX and movementY.
     * @param movementX - The amount to pan in the x direction.
     * @param movementY - The amount to pan in the y direction.
     */
    pan: createCallback(
      (movementX: number, movementY: number, savePos?: boolean) => {
        if (isNaN(movementX) || isNaN(movementY)) return;
        const { x, y } = unwrap(state);
        setState({
          x: x + movementX,
          y: y + movementY,
        });

        if (savePos) debouncedSaveState();
      }
    ),

    /**
     * Reset the canvas to the default state.
     */
    reset: createCallback(() => {
      setState(structuredClone(defaultRenderState));
    }),

    currentScale: () => {
      return state.scale;
    },

    defferedScale,

    currentPosition: () => {
      const x = state.x;
      const y = state.y;
      const vec = vec2(x, y);
      return vec;
    },

    currentSize: () => {
      return vec2(
        state.containerRect?.width ?? 0,
        state.containerRect?.height ?? 0
      );
    },

    setDomRect: (rect: DOMRect | undefined) => {
      setState({ containerRect: rect });
    },

    /**
     * Get the current viewBox of the canvas.
     * This is the canvas-space rectangle of the currently visible area of the canvas.
     */
    viewBox: () => {
      const s = state.scale;
      const w = state.containerRect?.width ?? 0;
      const h = state.containerRect?.height ?? 0;

      return Rect.fromParams({
        x: (-state.x - w / 2) / s,
        y: (-state.y - h / 2) / s,
        w: w / s,
        h: h / s,
      });
    },

    /**
     * Animate to a new view state. You can pass in optional targets for x, t, and scale.
     * If you pass in a target for scale, it will be clamped to the min and max zoom levels.
     * If you pass only scale, it will zoom toward the center of the canvas.
     */
    animateTo: createCallback(
      (
        target: { x?: number; y?: number; scale?: number },
        duration: number = 500,
        savePos?: boolean
      ) => {
        const { x, y, scale, containerRect } = unwrap(state);
        if (!containerRect) return;

        let targetX = x;
        let targetY = y;

        const targetScale =
          target.scale !== undefined
            ? clamp(target.scale, MIN_ZOOM, MAX_ZOOM)
            : scale;

        if (
          target.x === undefined &&
          target.y === undefined &&
          target.scale !== undefined
        ) {
          const canvasX = -x / scale;
          const canvasY = -y / scale;
          targetX = -canvasX * targetScale;
          targetY = -canvasY * targetScale;
        } else {
          if (target.x !== undefined) {
            targetX = target.x * targetScale;
          }
          if (target.y !== undefined) {
            targetY = target.y * targetScale;
          }
        }
        setAnimation({
          startX: x,
          startY: y,
          startScale: scale,
          targetX,
          targetY,
          targetScale,
          startTime: performance.now(),
          duration,
          isAnimating: true,
        });
        if (savePos) debouncedSaveState();
      }
    ),

    getCanvasRef: () => {},

    getLocation: () => {
      const s = state.scale;
      const x = state.x;
      const y = state.y;

      return { x: Math.round(x), y: Math.round(y), s: Math.round(s * 100) };
    },
  };
});

async function saveState(
  blockId: string,
  state: { x: number; y: number; scale: number }
) {
  if (isNaN(state.x) || isNaN(state.y) || isNaN(state.scale)) {
    return;
  }
  await storageServiceClient.upsertDocumentViewLocation({
    documentId: blockId,
    location:
      (state.x !== 0 ? '#x=' + Math.round(state.x) : '') +
      (state.y !== 0 ? '&y=' + Math.round(state.y) : '') +
      (state.scale !== 1 ? '&s=' + Math.round(state.scale * 100) : ''),
  });
}
