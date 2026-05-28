import { batch, createSignal, onCleanup } from 'solid-js';
import type { MobileSwipeLayout } from './createMobileSwipeLayout';

type ForwardAnimationPhase = 'idle' | 'preparing' | 'animating';

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
};

type MobileForwardAnimationOptions = {
  animationMs: number;
  bgPeekOffset: number;
  mobileSwipeLayout: MobileSwipeLayout;
};

export function createMobileForwardAnimation(
  options: MobileForwardAnimationOptions
) {
  const [phase, setPhase] = createSignal<ForwardAnimationPhase>('idle');

  let forwardStartFrame: ReturnType<typeof requestAnimationFrame> | undefined;
  let forwardSettleFrame: ReturnType<typeof requestAnimationFrame> | undefined;
  let forwardCompletionTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelFrame = (
    frame: ReturnType<typeof requestAnimationFrame> | undefined
  ) => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    return undefined;
  };

  function clearScheduledAnimation() {
    forwardStartFrame = cancelFrame(forwardStartFrame);
    forwardSettleFrame = cancelFrame(forwardSettleFrame);
    clearTimeout(forwardCompletionTimer);
    forwardCompletionTimer = undefined;
  }

  onCleanup(clearScheduledAnimation);

  function scheduleAnimationStart() {
    if (phase() !== 'preparing') return;
    if (forwardStartFrame !== undefined) return;
    forwardStartFrame = requestAnimationFrame(() => {
      forwardStartFrame = undefined;
      forwardSettleFrame = requestAnimationFrame(() => {
        forwardSettleFrame = undefined;
        if (phase() === 'preparing') {
          setPhase('animating');
          scheduleAnimationCompletion();
        }
      });
    });
  }

  function trigger() {
    if (phase() !== 'idle') return;

    clearScheduledAnimation();
    setPhase('preparing');
    scheduleAnimationStart();
  }

  function scheduleAnimationCompletion() {
    clearTimeout(forwardCompletionTimer);
    forwardCompletionTimer = setTimeout(() => {
      if (phase() === 'idle') return;
      completeForwardNavigation();
    }, options.animationMs + 250);
  }

  function completeForwardNavigation() {
    if (phase() === 'idle') return;
    clearScheduledAnimation();
    batch(() => {
      setPhase('idle');
      options.mobileSwipeLayout.completeNavigateForward();
    });
  }

  function handleTransitionEnd(e: TransitionEvent, isForeground: boolean) {
    if (e.target !== e.currentTarget) return;
    if (isForeground) return;
    if (e.propertyName !== 'transform') return;
    if (phase() !== 'animating') return;

    completeForwardNavigation();
  }

  function incomingStyle(): SplitTransformStyle {
    return {
      transform: phase() === 'animating' ? 'translateX(0)' : 'translateX(100%)',
      transition:
        phase() === 'animating'
          ? `transform ${options.animationMs}ms ease-out`
          : 'none',
      'will-change': 'transform',
    };
  }

  function outgoingStyle(): SplitTransformStyle {
    return {
      transform:
        phase() === 'animating'
          ? `translateX(${-options.bgPeekOffset}px)`
          : 'translateX(0)',
      transition:
        phase() === 'animating'
          ? `transform ${options.animationMs}ms ease-out`
          : 'none',
      'will-change': 'transform',
    };
  }

  function styleForSlot(isForeground: boolean) {
    return isForeground ? outgoingStyle() : incomingStyle();
  }

  return {
    phase,
    trigger,
    handleTransitionEnd,
    styleForSlot,
  };
}
