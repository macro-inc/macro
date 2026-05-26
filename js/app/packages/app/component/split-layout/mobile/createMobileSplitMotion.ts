import { cn } from '@ui';
import { onCleanup, onMount } from 'solid-js';
import type { SplitId } from '../layoutManager';
import { createMobileForwardAnimation } from './createMobileForwardAnimation';
import { createMobileSwipeBackGesture } from './createMobileSwipeBackGesture';
import type { MobileSwipeLayout } from './createMobileSwipeLayout';

const SWIPE_EDGE_THRESHOLD = 40; // px from left edge to initiate gesture
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms - fast flick completes swipe
const SWIPE_DISTANCE_THRESHOLD = 0.5; // fraction of screen width
const SWIPE_ANIMATION_MS = 88;
const BG_PEEK_OFFSET = 110; // px the BG panel is offset left at rest; closes to 0 as FG slides away

type MobileSplitMotionOptions = {
  mobileSwipeLayout: MobileSwipeLayout;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

export function createMobileSplitMotion(options: MobileSplitMotionOptions) {
  const { mobileSwipeLayout } = options;

  const forwardAnimation = createMobileForwardAnimation({
    animationMs: SWIPE_ANIMATION_MS,
    bgPeekOffset: BG_PEEK_OFFSET,
    mobileSwipeLayout,
    panelRefs: options.panelRefs,
  });
  const swipeBackGesture = createMobileSwipeBackGesture({
    animationMs: SWIPE_ANIMATION_MS,
    bgPeekOffset: BG_PEEK_OFFSET,
    edgeThreshold: SWIPE_EDGE_THRESHOLD,
    velocityThreshold: SWIPE_VELOCITY_THRESHOLD,
    distanceThreshold: SWIPE_DISTANCE_THRESHOLD,
    mobileSwipeLayout,
    canStart: () => forwardAnimation.phase() === 'idle',
  });

  onMount(() => {
    mobileSwipeLayout.setAnimatedTrigger(swipeBackGesture.trigger);
    mobileSwipeLayout.setForwardNavigationTrigger(() => {
      swipeBackGesture.reset();
      forwardAnimation.trigger();
    });
  });
  onCleanup(() => {
    mobileSwipeLayout.setAnimatedTrigger(undefined);
    mobileSwipeLayout.setForwardNavigationTrigger(undefined);
  });

  const forwardIsActive = () => forwardAnimation.phase() !== 'idle';

  function styleForSlot(isForeground: boolean) {
    if (forwardIsActive()) {
      return forwardAnimation.styleForSlot(isForeground);
    }
    return swipeBackGesture.styleForSlot(isForeground);
  }

  function classForSlot(isForeground: boolean) {
    return cn(
      'absolute inset-0',
      {
        'z-10': isForeground && !forwardIsActive(),
        'z-0 pointer-events-none':
          (!isForeground && !forwardIsActive()) ||
          (isForeground && forwardIsActive()),
        'z-user-highlight pointer-events-none':
          !isForeground && forwardIsActive(),
      },
      !isForeground &&
        !swipeBackGesture.isDragging() &&
        !swipeBackGesture.isAnimatingOut() &&
        !forwardIsActive() &&
        'hidden'
    );
  }

  return {
    classForSlot,
    styleForSlot,
    handlePanelRef: forwardAnimation.handlePanelRef,
    handleTransitionEnd: forwardAnimation.handleTransitionEnd,
    handleTouchStart: swipeBackGesture.handleTouchStart,
    handleTouchMove: swipeBackGesture.handleTouchMove,
    handleTouchEnd: swipeBackGesture.handleTouchEnd,
    handleTouchCancel: swipeBackGesture.handleTouchCancel,
  };
}
