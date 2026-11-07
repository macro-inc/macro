import { batch, createSignal, onCleanup } from 'solid-js';
import type { MobilePaneStack } from './createMobilePaneStack';

/**
 * Px of movement before a drag is treated as horizontal. Shared with message
 * row swipes so a rightward drag is claimed by back navigation on the same
 * move that the row gives it up.
 */
export const SWIPE_DIRECTION_SLOP_PX = 5;

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
  stack: MobilePaneStack;
  canStart: () => boolean;
};

export function createMobileSwipeBackGesture(
  options: MobileSwipeBackGestureOptions
) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let startTarget: Element | null = null;
  let gestureMode: 'idle' | 'pending' | 'dragging' = 'idle';
  let animationTimer: ReturnType<typeof setTimeout> | undefined;

  function clearScheduledAnimation() {
    clearTimeout(animationTimer);
  }

  onCleanup(clearScheduledAnimation);

  function reset() {
    clearScheduledAnimation();
    gestureMode = 'idle';
    startTarget = null;
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

  function handleTouchStart(e: TouchEvent) {
    if (!options.canStart() || isAnimatingOut()) return;
    if (!options.stack.canGoBack()) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;

    const target = eventElement(e.target);
    // The channel message list opts in: a rightward swipe from anywhere in
    // that list goes back. Wait until the drag is clearly horizontal so a
    // vertical scroll still scrolls. The composer is outside the region.
    if (target && canStartWideBack(target)) {
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      startTarget = target;
      gestureMode = 'pending';
      return;
    }

    const left =
      e.currentTarget instanceof Element
        ? e.currentTarget.getBoundingClientRect().left
        : 0;
    if (touch.clientX - left > options.edgeThreshold) return;
    // Buttons can sit inside the swipe-edge zone. If we start the gesture, the preventDefault() in touchmove suppresses the synthesized click on iOS.
    if (target?.closest('button, a, [role="button"]')) return;
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    gestureMode = 'dragging';
    setIsDragging(true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (gestureMode === 'idle') return;
    if (e.touches.length !== 1) {
      handleTouchCancel();
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;

    if (gestureMode === 'pending') {
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (
        Math.abs(dx) <= SWIPE_DIRECTION_SLOP_PX &&
        Math.abs(dy) <= SWIPE_DIRECTION_SLOP_PX
      ) {
        return;
      }
      const swipingBack =
        dx > SWIPE_DIRECTION_SLOP_PX && Math.abs(dx) > Math.abs(dy);
      // A sideways scroller that is already panned keeps a rightward drag,
      // so it can return to its start. At its start, that drag goes back.
      if (
        !swipingBack ||
        (startTarget && rightSwipeScrollsContent(startTarget))
      ) {
        gestureMode = 'idle';
        startTarget = null;
        return;
      }
      gestureMode = 'dragging';
      setIsDragging(true);
    }

    if (!isDragging()) return;
    e.preventDefault();
    const dx = Math.max(0, touch.clientX - startX);
    setDragOffset(dx);
  }

  function handleTouchEnd() {
    if (gestureMode === 'pending') {
      gestureMode = 'idle';
      return;
    }
    gestureMode = 'idle';
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
    if (gestureMode === 'pending') {
      gestureMode = 'idle';
      return;
    }
    gestureMode = 'idle';
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

function eventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

function canStartWideBack(target: Element): boolean {
  if (!target.closest('[data-swipe-back-region]')) return false;
  return !isTextField(target);
}

function isTextField(target: Element): boolean {
  if (target.closest('input, textarea, select')) return true;
  const editable = target.closest('[contenteditable]');
  return (
    editable instanceof Element &&
    editable.getAttribute('contenteditable') !== 'false'
  );
}

/**
 * Wide code blocks and tables scroll sideways. A rightward drag scrolls one
 * back toward its start only once it has been panned. The message list's own
 * scroller is marked `data-swipe-back-scroll`: its overflow-x computes to
 * auto because it scrolls vertically, and that must not swallow back swipes.
 */
function rightSwipeScrollsContent(target: Element): boolean {
  const region = target.closest('[data-swipe-back-region]');
  let el: Element | null = target;
  while (el && el !== region) {
    if (!el.hasAttribute('data-swipe-back-scroll') && scrollsHorizontally(el)) {
      return el.scrollLeft > 0;
    }
    el = el.parentElement;
  }
  return false;
}

function scrollsHorizontally(el: Element): boolean {
  return (
    el.scrollWidth > el.clientWidth &&
    /auto|scroll/.test(getComputedStyle(el).overflowX)
  );
}
