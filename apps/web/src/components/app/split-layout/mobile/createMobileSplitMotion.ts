import { cn } from '@ui';
import { createSignal, onCleanup, onMount } from 'solid-js';
import type { SplitId } from '../layoutManager';
import { createMobileForwardAnimation } from './createMobileForwardAnimation';
import type { MobilePaneStack } from './createMobilePaneStack';
import { createMobileSwipeBackGesture } from './createMobileSwipeBackGesture';

const SWIPE_EDGE_THRESHOLD = 40; // px from left edge to initiate gesture
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms - fast flick completes swipe
const SWIPE_DISTANCE_THRESHOLD = 0.5; // fraction of screen width
const SWIPE_ANIMATION_MS = 88;
const BG_PEEK_OFFSET = 110; // px the pane behind is offset left at rest; closes to 0 as the front slides away

export function createMobileSplitMotion(options: { stack: MobilePaneStack }) {
  const { stack } = options;

  const forwardAnimation = createMobileForwardAnimation({
    animationMs: SWIPE_ANIMATION_MS,
    bgPeekOffset: BG_PEEK_OFFSET,
  });
  const swipeBackGesture = createMobileSwipeBackGesture({
    animationMs: SWIPE_ANIMATION_MS,
    bgPeekOffset: BG_PEEK_OFFSET,
    edgeThreshold: SWIPE_EDGE_THRESHOLD,
    velocityThreshold: SWIPE_VELOCITY_THRESHOLD,
    distanceThreshold: SWIPE_DISTANCE_THRESHOLD,
    stack,
    canStart: () => forwardAnimation.phase() === 'idle',
  });

  const [outgoing, setOutgoing] = createSignal<SplitId>();

  onMount(() => {
    stack.setAnimatedTrigger(swipeBackGesture.trigger);
    stack.setForwardTrigger((from) => {
      setOutgoing(from);
      swipeBackGesture.reset();
      forwardAnimation.trigger();
    });
  });
  onCleanup(() => {
    stack.setAnimatedTrigger(undefined);
    stack.setForwardTrigger(undefined);
  });

  const forwardIsActive = () => forwardAnimation.phase() !== 'idle';

  /**
   * The pane presented as the active one. While a pane slides in, the one it
   * covers stays active, so its floating chrome stays until the slide ends.
   */
  const presentedFront = () => (forwardIsActive() ? outgoing() : stack.front());

  function styleFor(isFront: boolean) {
    if (forwardIsActive()) return forwardAnimation.styleFor(isFront);

    return swipeBackGesture.styleForSlot(isFront);
  }

  function classFor(isFront: boolean) {
    return cn(
      'absolute inset-0',
      isFront ? 'z-10' : 'z-0 pointer-events-none',
      !isFront &&
        !swipeBackGesture.isDragging() &&
        !swipeBackGesture.isAnimatingOut() &&
        !forwardIsActive() &&
        'invisible'
    );
  }

  return {
    presentedFront,
    classFor,
    styleFor,
    handleTransitionEnd: forwardAnimation.handleTransitionEnd,
    handleTouchStart: swipeBackGesture.handleTouchStart,
    handleTouchMove: swipeBackGesture.handleTouchMove,
    handleTouchEnd: swipeBackGesture.handleTouchEnd,
    handleTouchCancel: swipeBackGesture.handleTouchCancel,
  };
}
