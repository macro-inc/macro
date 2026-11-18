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
};

export function createMobileSwipeBackGesture(
  options: MobileSwipeBackGestureOptions
) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
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
      setIsDragging(false);
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
    animateComplete();
  }

  const gesture = createMobileEdgeSwipe({
    enabled: () => options.canGoBack() && !isAnimatingOut(),
    onStart: () => setIsDragging(true),
    onMove: setDragOffset,
    onEnd(completed) {
      batch(() => {
        setIsDragging(false);
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
