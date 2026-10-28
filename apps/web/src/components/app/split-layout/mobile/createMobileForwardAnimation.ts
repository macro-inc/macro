import { createSignal, onCleanup } from 'solid-js';

type ForwardAnimationPhase = 'idle' | 'preparing' | 'animating';

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
};

type MobileForwardAnimationOptions = {
  animationMs: number;
  bgPeekOffset: number;
};

/** Slides a pane that just landed in front over the one now behind it. */
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
    clearScheduledAnimation();
    setPhase('preparing');
    scheduleAnimationStart();
  }

  function scheduleAnimationCompletion() {
    clearTimeout(forwardCompletionTimer);
    forwardCompletionTimer = setTimeout(complete, options.animationMs + 250);
  }

  function complete() {
    if (phase() === 'idle') return;
    clearScheduledAnimation();
    setPhase('idle');
  }

  function handleTransitionEnd(e: TransitionEvent, isFront: boolean) {
    if (e.target !== e.currentTarget) return;
    if (!isFront) return;
    if (e.propertyName !== 'transform') return;
    if (phase() !== 'animating') return;

    complete();
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

  /** The front pane slides in; the pane behind it slides back to its peek offset. */
  function styleFor(isFront: boolean) {
    return isFront ? incomingStyle() : outgoingStyle();
  }

  return {
    phase,
    trigger,
    reset: complete,
    handleTransitionEnd,
    styleFor,
  };
}
