import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { ZoompinchHandle } from '../Zoompinch';
import type { createMomentum } from './createMomentum';

type GesturesInput = {
  zoompinchHandle: Accessor<ZoompinchHandle | undefined>;
  totalZoom: Accessor<number>;
  currentScale: Accessor<number>;
  applyZoom: (
    handle: ZoompinchHandle,
    zoomLevel: number,
    anchor?: [number, number]
  ) => void;
  momentum: ReturnType<typeof createMomentum>;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

/**
 * Routes pointer input across the lightbox's three gesture systems: the
 * zoompinch engine (pan/pinch while zoomed in), single-finger swipes (gallery
 * nav + swipe-to-dismiss while zoomed out), and the inertial fling on release.
 * Also wires desktop keyboard nav and mouse drag / click-to-zoom. Returns the
 * reactive cursor and the touch handlers to hand to <Zoompinch>.
 */
export function createGestures(input: GesturesInput) {
  const {
    zoompinchHandle,
    totalZoom,
    currentScale,
    applyZoom,
    momentum,
    onPrevious,
    onNext,
    onClose,
  } = input;

  // Reactive cursor state — drives the cursor style on the Zoompinch wrapper.
  const [isDragging, setIsDragging] = createSignal(false);

  const cursor = createMemo(() => {
    if (isDragging() && currentScale() > 1.01) return 'grab';
    if (totalZoom() > 1.01) return 'zoom-out';
    return 'zoom-in';
  });

  // Single-finger swipe state. On touch devices, when fully zoomed out, a
  // single-finger drag is a swipe gesture: horizontal navigates the gallery,
  // a downward swipe dismisses the lightbox. The axis is locked on the first
  // clearly-directional movement so the two don't fight.
  const SWIPE_DISMISS_DISTANCE = 100; // px of downward travel to dismiss
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeEndX = 0;
  let swipeEndY = 0;
  let swipeAxis: 'x' | 'y' | null = null;
  let isSwiping = false;
  let zoompinchHandlingTouch = false;

  const onStart = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    // Any new touch catches an in-flight glide (tap-to-stop).
    momentum.cancelMomentum();
    const doSwipeDetection =
      isTouchDevice() && e.touches.length === 1 && totalZoom() <= 1.01;
    if (doSwipeDetection) {
      swipeStartX = swipeEndX = e.touches[0].clientX;
      swipeStartY = swipeEndY = e.touches[0].clientY;
      swipeAxis = null;
      isSwiping = false;
      zoompinchHandlingTouch = false;
    } else {
      engine.handleTouchstart(e);
      zoompinchHandlingTouch = true;
      momentum.resetMomentumTracking(e, engine);
    }
  };

  const onWindowMove = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    if (zoompinchHandlingTouch) {
      engine.handleTouchmove(e);
      // Track velocity for single-finger pans only; a pinch shouldn't fling.
      if (e.touches.length === 1) momentum.sampleMomentum(e);
      else momentum.resetMomentumTracking(e, engine);
      return;
    }
    // Second finger appeared mid-gesture: switch to zoompinch
    if (e.touches.length > 1) {
      engine.handleTouchstart(e);
      zoompinchHandlingTouch = true;
      isSwiping = false;
      momentum.resetMomentumTracking(e, engine);
      return;
    }
    swipeEndX = e.touches[0].clientX;
    swipeEndY = e.touches[0].clientY;
    const dx = swipeEndX - swipeStartX;
    const dy = swipeEndY - swipeStartY;
    // Lock to the dominant axis once the gesture is clearly directional.
    if (!swipeAxis && Math.hypot(dx, dy) > 10) {
      swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    // Downward-only on the y axis — an upward drag is left alone.
    if (
      (swipeAxis === 'x' && Math.abs(dx) > 30) ||
      (swipeAxis === 'y' && dy > 30)
    ) {
      isSwiping = true;
    }
    if (isSwiping) e.preventDefault();
  };

  const onWindowEnd = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    if (zoompinchHandlingTouch) {
      engine.handleTouchend(e);
      // Fling only when the last finger lifts after a single-finger pan while
      // zoomed in — releasing one finger of a pinch leaves touches behind, and
      // there's nothing to pan when the image already fits.
      if (e.touches.length === 0) {
        zoompinchHandlingTouch = false;
        if (totalZoom() > 1.01) momentum.startMomentum(e, engine);
      } else {
        momentum.resetMomentumTracking(e, engine);
      }
      return;
    }
    if (isSwiping && totalZoom() <= 1.01) {
      if (swipeAxis === 'x') {
        const diff = swipeStartX - swipeEndX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) onNext();
          else onPrevious();
        }
      } else if (
        swipeAxis === 'y' &&
        swipeEndY - swipeStartY > SWIPE_DISMISS_DISTANCE
      ) {
        onClose();
      }
    }
    swipeAxis = null;
    isSwiping = false;
    swipeStartX = swipeStartY = swipeEndX = swipeEndY = 0;
    zoompinchHandlingTouch = false;
  };

  // Keyboard nav + desktop mouse drag / click-to-zoom — active while the
  // Zoompinch handle is set.
  createEffect(() => {
    const handle = zoompinchHandle();
    if (!handle) return;
    const { engine, wrapperElement: wrapper } = handle;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (!isMobile()) {
      // Track dragging so click-to-zoom and cursor stay in sync
      let isMouseDown = false;
      let mouseDownX = 0;
      let mouseDownY = 0;

      const handleMouseDown = (e: MouseEvent) => {
        isMouseDown = true;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        setIsDragging(false);
      };
      const handleWindowMouseMove = (e: MouseEvent) => {
        if (!isMouseDown) return;
        if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > 5) {
          setIsDragging(true);
        }
      };
      const handleWindowMouseUp = () => {
        isMouseDown = false;
        // Delay reset so the click event (which fires after mouseup) can still
        // read isDragging=true and suppress the zoom-out action.
        setTimeout(() => setIsDragging(false), 0);
      };

      // Click-to-zoom: zoom in at cursor position, or reset if already zoomed
      const handleClick = (e: MouseEvent) => {
        if (isDragging()) return;
        const b = engine.wrapperBounds;
        const relX = (e.clientX - b.x) / b.width;
        const relY = (e.clientY - b.y) / b.height;
        if (totalZoom() <= 1.01) {
          applyZoom(handle, 2.5, [relX, relY]);
        } else {
          applyZoom(handle, 1);
        }
      };

      wrapper.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
      wrapper.addEventListener('click', handleClick);

      onCleanup(() => {
        wrapper.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
        wrapper.removeEventListener('click', handleClick);
      });
    }

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return {
    cursor,
    touch: { onStart, onWindowMove, onWindowEnd },
  };
}
