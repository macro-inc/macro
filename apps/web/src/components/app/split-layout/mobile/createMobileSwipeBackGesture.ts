import { fireAndForget } from '@core/util/fireAndForget';
import { batch, createSignal, onCleanup } from 'solid-js';
import { createMobileEdgeSwipe } from './createMobileEdgeSwipe';

export const SWIPE_ANIMATION_MS = 88;
export const BG_PEEK_OFFSET = 110;

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
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

  function animateComplete() {
    clearScheduledAnimation();
    setIsAnimatingOut(true);
    setDragOffset(width());
    animationTimer = setTimeout(() => {
      fireAndForget(completeBack(), 'mobile-swipe-back');
    }, SWIPE_ANIMATION_MS);
  }

  function animateSnapBack() {
    clearScheduledAnimation();
    setIsAnimatingOut(true);
    setDragOffset(0);
    animationTimer = setTimeout(
      () => setIsAnimatingOut(false),
      SWIPE_ANIMATION_MS
    );
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
      return `transform ${SWIPE_ANIMATION_MS}ms ease-out`;
    }
    return 'none';
  }

  function foregroundStyle(): SplitTransformStyle {
    return {
      transform: `translateX(${dragOffset()}px)`,
      transition: getTransition(),
      'will-change': 'transform',
    };
  }

  function backgroundStyle(): SplitTransformStyle {
    return {
      transform: `translateX(${(Math.min(dragOffset() / width(), 1) - 1) * BG_PEEK_OFFSET}px)`,
      transition: getTransition(),
      'will-change': 'transform',
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
