import { createEffect, on, onCleanup } from 'solid-js';
import { type PagerDirection, usePager } from './Pager';

const DEFAULT_DIRECTION_LOCK_DISTANCE = 8;
const DEFAULT_VELOCITY_ACTIVATION_DISTANCE = 24;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;
const RELEASE_VELOCITY_WINDOW = 100;

interface ActiveGesture {
  axis: 'x' | 'y' | undefined;
  claimed: boolean;
  currentX: number;
  currentY: number;
  samples: Array<{ time: number; x: number }>;
  startX: number;
  startY: number;
}

/** Options for adding mobile swipe input to a generic pager. */
export interface PagerSwipeGesturesProps {
  /** Allows a consumer to reject a touch based on its initial event. */
  canStart?: (event: TouchEvent) => boolean;
  /** Ignores touches beginning within this distance of either pager edge. */
  edgeInset?: number;
  /** Distance used to distinguish horizontal and vertical gestures. */
  directionLockDistance?: number;
  /** Distance required to commit, or a fraction of viewport width when below one. */
  activationDistance?: number;
  /** Release velocity in pixels per millisecond that can commit a page change. */
  velocityThreshold?: number;
}

/** Adds touch-only horizontal swipe input to the nearest `Pager.Root`. */
export function PagerSwipeGestures(props: PagerSwipeGesturesProps) {
  const pager = usePager<unknown>();

  createEffect(
    on(pager.viewport, (viewport) => {
      if (!viewport) return;

      let activeGesture: ActiveGesture | undefined;
      let suppressClick = false;
      let suppressClickTimer: number | undefined;
      const previousTouchAction = viewport.style.touchAction;
      viewport.style.touchAction = 'pan-y';

      const clearSuppressClickTimer = () => {
        if (suppressClickTimer === undefined) return;
        clearTimeout(suppressClickTimer);
        suppressClickTimer = undefined;
      };

      const animateBackAfterInterruption = () => {
        const shouldAnimateBack = activeGesture?.claimed;
        activeGesture = undefined;

        if (!shouldAnimateBack) return;

        pager.cancelDrag();
      };

      const handleTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
          animateBackAfterInterruption();
          return;
        }

        if (pager.phase() !== 'idle') return;

        const touch = event.touches[0];
        if (!touch || props.canStart?.(event) === false) return;

        const edgeInset = props.edgeInset ?? 0;
        const viewportBounds = viewport.getBoundingClientRect();
        if (
          edgeInset > 0 &&
          (touch.clientX <= viewportBounds.left + edgeInset ||
            touch.clientX >= viewportBounds.right - edgeInset)
        ) {
          return;
        }

        activeGesture = {
          axis: undefined,
          claimed: false,
          currentX: touch.clientX,
          currentY: touch.clientY,
          samples: [{ time: event.timeStamp, x: touch.clientX }],
          startX: touch.clientX,
          startY: touch.clientY,
        };
      };

      const handleTouchMove = (event: TouchEvent) => {
        const gesture = activeGesture;
        const touch = event.touches[0];
        if (!gesture || event.touches.length !== 1 || !touch) {
          animateBackAfterInterruption();
          return;
        }

        gesture.currentX = touch.clientX;
        gesture.currentY = touch.clientY;
        const deltaX = gesture.currentX - gesture.startX;
        const deltaY = gesture.currentY - gesture.startY;
        if (gesture.axis === undefined) {
          const directionLockDistance =
            props.directionLockDistance ?? DEFAULT_DIRECTION_LOCK_DISTANCE;
          if (Math.hypot(deltaX, deltaY) < directionLockDistance) return;

          gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
          if (gesture.axis === 'x') {
            gesture.claimed = pager.beginDrag();
          }
        }

        if (gesture.axis !== 'x' || !gesture.claimed) return;

        gesture.samples.push({ time: event.timeStamp, x: gesture.currentX });
        while (
          gesture.samples.length > 2 &&
          event.timeStamp - gesture.samples[0].time > RELEASE_VELOCITY_WINDOW
        ) {
          gesture.samples.shift();
        }
        pager.updateDrag(deltaX);
        if (event.cancelable) event.preventDefault();
      };

      const releaseVelocity = (gesture: ActiveGesture, endTime: number) => {
        const samples = gesture.samples.filter(
          (sample) => endTime - sample.time <= RELEASE_VELOCITY_WINDOW
        );
        const first = samples[0];
        const last = samples.at(-1);
        if (!first || !last || last.time <= first.time) return 0;

        return (last.x - first.x) / (last.time - first.time);
      };

      const activationDistance = () => {
        const configured = props.activationDistance;
        if (configured === undefined) {
          return Math.min(96, Math.max(48, viewport.clientWidth * 0.2));
        }

        if (configured < 1) {
          return viewport.clientWidth * configured;
        }

        return configured;
      };

      const suppressSyntheticClick = () => {
        suppressClick = true;
        clearSuppressClickTimer();
        suppressClickTimer = window.setTimeout(() => {
          suppressClick = false;
          suppressClickTimer = undefined;
        }, 400);
      };

      const handleTouchEnd = (event: TouchEvent) => {
        const gesture = activeGesture;
        activeGesture = undefined;

        if (!gesture || gesture.axis !== 'x' || !gesture.claimed) return;
        if (event.touches.length > 0) {
          pager.cancelDrag();
          return;
        }

        suppressSyntheticClick();
        if (event.cancelable) event.preventDefault();

        const touch = event.changedTouches[0];
        if (touch) gesture.currentX = touch.clientX;

        const offset = gesture.currentX - gesture.startX;
        const velocity = releaseVelocity(gesture, event.timeStamp);
        const velocityThreshold =
          props.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD;
        const commitsByDistance = Math.abs(offset) >= activationDistance();
        const commitsByVelocity =
          Math.abs(offset) >= DEFAULT_VELOCITY_ACTIVATION_DISTANCE &&
          Math.abs(velocity) >= velocityThreshold &&
          Math.sign(velocity) === Math.sign(offset);

        if (!commitsByDistance && !commitsByVelocity) {
          pager.cancelDrag();
          return;
        }

        const direction: PagerDirection = offset < 0 ? 'next' : 'previous';
        void pager.commitDrag(direction);
      };

      const handleTouchCancel = animateBackAfterInterruption;
      const handleClick = (event: MouseEvent) => {
        if (!suppressClick) return;
        suppressClick = false;
        clearSuppressClickTimer();
        event.preventDefault();
        event.stopPropagation();
      };

      viewport.addEventListener('touchstart', handleTouchStart, {
        passive: true,
      });
      viewport.addEventListener('touchmove', handleTouchMove, {
        passive: false,
      });
      viewport.addEventListener('touchend', handleTouchEnd, {
        passive: false,
      });
      viewport.addEventListener('touchcancel', handleTouchCancel, {
        passive: true,
      });
      viewport.addEventListener('click', handleClick, true);

      onCleanup(() => {
        animateBackAfterInterruption();
        clearSuppressClickTimer();
        viewport.style.touchAction = previousTouchAction;
        viewport.removeEventListener('touchstart', handleTouchStart);
        viewport.removeEventListener('touchmove', handleTouchMove);
        viewport.removeEventListener('touchend', handleTouchEnd);
        viewport.removeEventListener('touchcancel', handleTouchCancel);
        viewport.removeEventListener('click', handleClick, true);
      });
    })
  );

  return null;
}
