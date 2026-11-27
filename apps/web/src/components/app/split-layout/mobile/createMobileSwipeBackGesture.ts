import { fireAndForget } from '@core/util/fireAndForget';
import { batch, createSignal, onCleanup } from 'solid-js';
import { createMobileEdgeSwipe } from './createMobileEdgeSwipe';

/** UIKit's push and pop: about 400ms on a curve that settles softly. */
export const PANE_TRANSITION_MS = 400;
export const PANE_TRANSITION_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** How far the pane behind travels, as a fraction of the pane width. */
export const BACKGROUND_PARALLAX = 0.3;
/** Casts the moving pane's edge over the one it reveals. */
export const MOVING_PANE_SHADOW = '-4px 0 16px rgb(0 0 0 / 0.12)';
/** The shortest settle, so a release near the end still eases in. */
const MIN_SETTLE_MS = 120;

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
  'box-shadow': string;
};

type MobileSwipeBackGestureOptions = {
  canGoBack: () => boolean;
  completeGoBack: () => void | Promise<void>;
  width?: () => number;
  inPaneBack?: { canGoBack(): boolean; goBack(): void };
};

export function createMobileSwipeBackGesture(
  options: MobileSwipeBackGestureOptions
) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal<false | 'pane' | 'route'>(false);
  const isDragging = () => dragging() !== false;
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);
  const [settleMs, setSettleMs] = createSignal(PANE_TRANSITION_MS);

  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  let animation = 0;
  const width = () => options.width?.() || window.innerWidth;

  function clearScheduledAnimation() {
    clearTimeout(animationTimer);
    animation++;
  }

  onCleanup(clearScheduledAnimation);

  function reset() {
    gesture.reset();
    clearScheduledAnimation();
    batch(() => {
      setDragging(false);
      setIsAnimatingOut(false);
      setDragOffset(0);
    });
  }

  async function completeBack() {
    const current = animation;
    try {
      await options.completeGoBack();
    } finally {
      if (current === animation) reset();
    }
  }

  /**
   * Like an interactive UIKit transition, a released pane plays only the part
   * of the transition still ahead of it: the time is the full duration scaled
   * by the share of the width left to travel.
   */
  function settleDuration(from: number, to: number) {
    const remaining = Math.abs(to - from) / width();
    return Math.max(MIN_SETTLE_MS, Math.round(PANE_TRANSITION_MS * remaining));
  }

  function animateComplete() {
    clearScheduledAnimation();
    const duration = settleDuration(dragOffset(), width());
    batch(() => {
      setSettleMs(duration);
      setIsAnimatingOut(true);
      setDragOffset(width());
    });
    animationTimer = setTimeout(() => {
      fireAndForget(completeBack(), 'mobile-swipe-back');
    }, duration);
  }

  function animateSnapBack() {
    clearScheduledAnimation();
    const duration = settleDuration(dragOffset(), 0);
    batch(() => {
      setSettleMs(duration);
      setIsAnimatingOut(true);
      setDragOffset(0);
    });
    animationTimer = setTimeout(() => setIsAnimatingOut(false), duration);
  }

  function trigger() {
    if (!options.canGoBack() || isAnimatingOut()) return;
    if (options.inPaneBack?.canGoBack()) {
      // Navigation can expose a route step during a pane drag. Clear its offset first.
      reset();
      options.inPaneBack.goBack();
      return;
    }
    animateComplete();
  }

  const gesture = createMobileEdgeSwipe({
    enabled: () => options.canGoBack() && !isAnimatingOut(),
    onStart: () =>
      setDragging(options.inPaneBack?.canGoBack() ? 'route' : 'pane'),
    onMove: setDragOffset,
    onEnd(completed) {
      if (dragging() === 'route') {
        reset();
        if (completed && options.inPaneBack?.canGoBack())
          options.inPaneBack.goBack();
        return;
      }
      batch(() => {
        setDragging(false);
        if (completed) trigger();
        else animateSnapBack();
      });
    },
  });

  function getTransition(): string {
    if (isDragging()) return 'none';
    if (isAnimatingOut()) {
      return `transform ${settleMs()}ms ${PANE_TRANSITION_EASING}`;
    }
    return 'none';
  }

  const isMoving = () => isDragging() || isAnimatingOut();

  function foregroundStyle(): SplitTransformStyle {
    return {
      transform: `translateX(${dragOffset()}px)`,
      transition: getTransition(),
      'will-change': 'transform',
      'box-shadow': isMoving() ? MOVING_PANE_SHADOW : 'none',
    };
  }

  function backgroundStyle(): SplitTransformStyle {
    const progress = Math.min(dragOffset() / width(), 1);
    const offset = (progress - 1) * BACKGROUND_PARALLAX * width();

    return {
      transform: `translateX(${offset}px)`,
      transition: getTransition(),
      'will-change': 'transform',
      'box-shadow': 'none',
    };
  }

  function styleForSlot(isForeground: boolean) {
    // An in-pane route has no second pane to reveal; keep the current view
    // stationary until the gesture commits instead of previewing another pane.
    if (dragging() === 'route')
      return {
        transform: 'none',
        transition: 'none',
        'will-change': 'auto',
        'box-shadow': 'none',
      };
    return isForeground ? foregroundStyle() : backgroundStyle();
  }

  return {
    isDragging,
    isAnimatingOut,
    reset,
    trigger,
    handleTouchStart: gesture.handleTouchStart,
    handleTouchMove: gesture.handleTouchMove,
    handleTouchEnd: gesture.handleTouchEnd,
    handleTouchCancel: gesture.handleTouchCancel,
    styleForSlot,
  };
}
