import { createSignal, onCleanup } from 'solid-js';

type ForwardAnimationPhase = 'idle' | 'preparing' | 'animating';

type SplitTransformStyle = {
  transform: string;
  transition: string;
  'will-change': string;
  'box-shadow': string;
};

type MobileForwardAnimationOptions = {
  animationMs: number;
  easing: string;
  /** How far the covered pane travels, as a fraction of its width. */
  backgroundParallax: number;
  /** Shadow on the incoming pane's edge while it slides. */
  movingShadow: string;
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

  function transition() {
    if (phase() !== 'animating') return 'none';
    return `transform ${options.animationMs}ms ${options.easing}`;
  }

  function incomingStyle(): SplitTransformStyle {
    return {
      transform: phase() === 'animating' ? 'translateX(0)' : 'translateX(100%)',
      transition: transition(),
      'will-change': 'transform',
      'box-shadow': phase() === 'idle' ? 'none' : options.movingShadow,
    };
  }

  function outgoingStyle(): SplitTransformStyle {
    // A percentage translate is of the pane's own width, which is the stack's.
    const offset = `${-options.backgroundParallax * 100}%`;

    return {
      transform:
        phase() === 'animating' ? `translateX(${offset})` : 'translateX(0)',
      transition: transition(),
      'will-change': 'transform',
      'box-shadow': 'none',
    };
  }

  /** The front pane slides in; the pane behind it slides part of the way left. */
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
