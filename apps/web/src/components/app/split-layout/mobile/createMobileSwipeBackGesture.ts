import { batch, createSignal, onCleanup } from 'solid-js';
import { createMobileEdgeSwipe } from './createMobileEdgeSwipe';
import type { MobilePaneStack } from './createMobilePaneStack';

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
};

type MobileSwipeBackGestureOptions = {
  animationMs: number;
  bgPeekOffset: number;
  stack: MobilePaneStack;
  canStart: () => boolean;
};

export function createMobileSwipeBackGesture(
  options: MobileSwipeBackGestureOptions
) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);

  let animationTimer: ReturnType<typeof setTimeout> | undefined;

  function clearScheduledAnimation() {
    clearTimeout(animationTimer);
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
    if (!options.stack.canGoBack()) return;
    animateComplete(() => options.stack.completeGoBack());
  }

  const gesture = createMobileEdgeSwipe({
    enabled: () =>
      options.canStart() && !isAnimatingOut() && options.stack.canGoBack(),
    onStart: () => setIsDragging(true),
    onMove: setDragOffset,
    onEnd(completed) {
      setIsDragging(false);
      if (completed) trigger();
      else animateSnapBack();
    },
  });

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
    handleTouchStart: gesture.handleTouchStart,
    handleTouchMove: gesture.handleTouchMove,
    handleTouchEnd: gesture.handleTouchEnd,
    handleTouchCancel: gesture.handleTouchCancel,
    styleForSlot,
  };
}
