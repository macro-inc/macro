import { batch, createSignal, onCleanup } from 'solid-js';
import type { MobileSwipeLayout } from './createMobileSwipeLayout';

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
};

type MobileSwipeBackGestureOptions = {
  animationMs: number;
  bgPeekOffset: number;
  edgeThreshold: number;
  velocityThreshold: number;
  distanceThreshold: number;
  mobileSwipeLayout: MobileSwipeLayout;
  canStart: () => boolean;
};

export function createMobileSwipeBackGesture(
  options: MobileSwipeBackGestureOptions
) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);

  let startX = 0;
  let startTime = 0;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;

  function clearScheduledAnimation() {
    clearTimeout(animationTimer);
  }

  onCleanup(clearScheduledAnimation);

  function reset() {
    clearScheduledAnimation();
    batch(() => {
      setIsDragging(false);
      setIsAnimatingOut(false);
      setDragOffset(0);
    });
  }

  function animateComplete(onDone: () => void) {
    clearScheduledAnimation();
    setIsAnimatingOut(true);
    setDragOffset(window.innerWidth);
    animationTimer = setTimeout(() => {
      batch(() => {
        setIsAnimatingOut(false);
        setDragOffset(0);
        onDone();
      });
    }, options.animationMs);
  }

  function animateSnapBack() {
    clearScheduledAnimation();
    setIsAnimatingOut(true);
    setDragOffset(0);
    animationTimer = setTimeout(
      () => setIsAnimatingOut(false),
      options.animationMs
    );
  }

  function trigger() {
    if (!options.canStart() || isAnimatingOut()) return;
    if (!options.mobileSwipeLayout.canGoBack()) return;
    animateComplete(() => options.mobileSwipeLayout.completeSwipeBack());
  }

  function handleTouchStart(e: TouchEvent) {
    if (!options.canStart() || isAnimatingOut()) return;
    if (!options.mobileSwipeLayout.canGoBack()) return;
    const touch = e.touches[0];
    if (!touch || touch.clientX > options.edgeThreshold) return;
    // Buttons can sit inside the swipe-edge zone. If we start the gesture, the preventDefault() in touchmove suppresses the synthesized click on iOS.
    if (
      e.target instanceof Element &&
      e.target.closest('button, a, [role="button"]')
    ) {
      return;
    }
    startX = touch.clientX;
    startTime = Date.now();
    setIsDragging(true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging()) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.max(0, touch.clientX - startX);
    setDragOffset(dx);
  }

  function handleTouchEnd() {
    if (!isDragging()) return;
    setIsDragging(false);
    const dx = dragOffset();
    const elapsed = Date.now() - startTime;
    const velocity = elapsed > 0 ? dx / elapsed : 0;
    const threshold = window.innerWidth * options.distanceThreshold;
    if (dx > threshold || velocity > options.velocityThreshold) {
      trigger();
    } else {
      animateSnapBack();
    }
  }

  function handleTouchCancel() {
    if (!isDragging()) return;
    setIsDragging(false);
    animateSnapBack();
  }

  function getTransition(): string {
    if (isDragging()) return 'none';
    if (isAnimatingOut()) {
      return `transform ${options.animationMs}ms ease-out`;
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
      transform: `translateX(${-options.bgPeekOffset + (dragOffset() / window.innerWidth) * options.bgPeekOffset}px)`,
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
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    styleForSlot,
  };
}
