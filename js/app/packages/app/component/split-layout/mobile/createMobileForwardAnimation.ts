import { batch, createSignal, onCleanup } from 'solid-js';
import type { SplitId } from '../layoutManager';
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
  panelRefs: Map<SplitId, HTMLDivElement>;
};

export function createMobileForwardAnimation(
  options: MobileForwardAnimationOptions
) {
  const [phase, setPhase] = createSignal<ForwardAnimationPhase>('idle');

  let forwardStartFrame: ReturnType<typeof requestAnimationFrame> | undefined;
  let forwardSettleFrame: ReturnType<typeof requestAnimationFrame> | undefined;

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
  }

  onCleanup(clearScheduledAnimation);

  function incomingSplitId() {
    return options.mobileSwipeLayout.fgIsSlotA()
      ? options.mobileSwipeLayout.slotBSplitId()
      : options.mobileSwipeLayout.slotASplitId();
  }

  function incomingPanelIsMounted() {
    const splitId = incomingSplitId();
    if (!splitId) return false;
    return options.panelRefs.get(splitId)?.isConnected === true;
  }

  function scheduleAnimationStartIfReady() {
    if (phase() !== 'preparing') return;
    if (!incomingPanelIsMounted()) return;
    scheduleAnimationStart();
  }

  function scheduleAnimationStart() {
    if (forwardStartFrame !== undefined) return;
    forwardStartFrame = requestAnimationFrame(() => {
      forwardStartFrame = undefined;
      forwardSettleFrame = requestAnimationFrame(() => {
        forwardSettleFrame = undefined;
        if (phase() === 'preparing') {
          setPhase('animating');
        }
      });
    });
  }

  function trigger() {
    if (phase() !== 'idle') return;

    clearScheduledAnimation();
    setPhase('preparing');
    scheduleAnimationStartIfReady();
  }

  function handleTransitionEnd(e: TransitionEvent, isForeground: boolean) {
    if (e.target !== e.currentTarget) return;
    if (isForeground) return;
    if (e.propertyName !== 'transform') return;
    if (phase() !== 'animating') return;

    batch(() => {
      setPhase('idle');
      options.mobileSwipeLayout.completeNavigateForward();
    });
  }

  function handlePanelRef(
    splitId: SplitId,
    ref: HTMLDivElement,
    isForeground: boolean
  ) {
    options.panelRefs.set(splitId, ref);
    if (!isForeground && splitId === incomingSplitId()) {
      scheduleAnimationStartIfReady();
    }
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
    handlePanelRef,
    styleForSlot,
  };
}
