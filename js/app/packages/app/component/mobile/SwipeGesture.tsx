import { impactFeedback } from '@tauri-apps/plugin-haptics';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';

// Demo parity constants
const SWIPE_ACTIVATION_DISTANCE = 75; // Threshold, in pixels, of dx past which releasing touch will activate swipe gesture;
const DIRECTIONALITY_THRESHOLD = 5; // Threshold, in pixels, of either dx or dy, past which a gesture is considered "horizontal" or "vertical". Note: it is not obvious that these should both be the same value... we may want to experiment more.
const AUTO_ACTIVATION_PERCENTAGE = 0.75; // Percentage of container width past which the swipe gesture auto activates.

const TRANSLATE_AFTER_TRIGGERED_SPEED = 100; // ms;
const SPRING_BACK_SPEED = 250; // ms;
const COLLAPSE_SPEED = 250; // ms;

const SWIPE_PHASES = [
  'idle',
  'dragging',
  'threshold',
  'triggered',
  'collapsing',
  'complete',
] as const;

type SwipePhase = (typeof SWIPE_PHASES)[number];

const SWIPE_PHASE_RANK: Record<SwipePhase, number> = {
  idle: 0,
  dragging: 1,
  threshold: 2,
  triggered: 3,
  collapsing: 4,
  complete: 5,
};

const isAtLeastPhase = (phase: SwipePhase, minInclusive: SwipePhase) =>
  SWIPE_PHASE_RANK[phase] >= SWIPE_PHASE_RANK[minInclusive];

type SwipeDirection = 'left' | 'right' | null;

type SwipeActivationState = {
  direction: SwipeDirection;
  phase: SwipePhase;
};

type SwipeRowElements = {
  rowEl: HTMLDivElement;
  swipeEl: HTMLDivElement;
  contentEl: HTMLDivElement;
  leftRevealEl?: Element | null;
  rightRevealEl?: Element | null;
};

type SwipeTouchState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSwipeGesture: boolean | null;
  entityId: string | null;
  elements: SwipeRowElements | undefined;
};

type SwipeGestureContextValue = {
  activationStateFor: (entityId: string) => SwipeActivationState;
};

const SwipeGestureContext = createContext<SwipeGestureContextValue>();

export function SwipeGestureProvider(
  props: ParentProps<{
    container: Accessor<HTMLElement | undefined>;
    canSwipeRight?: (entityId: string) => boolean;
    canSwipeLeft?: (entityId: string) => boolean;
    onSwipeRight?: (entityId: string) => void;
    onSwipeLeft?: (entityId: string) => void;
  }>
) {
  const [activationStateById, setActivationStateById] = createSignal<
    Record<string, SwipeActivationState>
  >(Object.create(null));

  const setActivationState = (
    entityId: string,
    activationState: SwipeActivationState
  ) => {
    setActivationStateById((prev) => ({
      ...prev,
      [entityId]: activationState,
    }));
  };
  let touchState: SwipeTouchState = {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwipeGesture: null,
    entityId: null,
    elements: undefined,
  };

  let rafId: number | null = null;

  const resetTouchState = () => {
    touchState = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isSwipeGesture: null,
      entityId: null,
      elements: undefined,
    };
  };

  function springBack() {
    if (!touchState.elements || !touchState.entityId) return;
    const { contentEl } = touchState.elements;
    const entityId = touchState.entityId;
    contentEl.style.transition = `transform ${SPRING_BACK_SPEED}ms ease-out`;
    contentEl.style.transform = 'translateX(0px)';

    setTimeout(() => {
      contentEl.style.transition = '';
      setActivationState(entityId, { direction: null, phase: 'idle' });
    }, SPRING_BACK_SPEED);
  }

  const handleSwipeRight = async (entityId: string) => {
    const els = touchState.elements;
    if (!els) return;
    const onSwipeRight = props.onSwipeRight;
    if (!onSwipeRight) return;

    els.contentEl.style.transition = `transform ${TRANSLATE_AFTER_TRIGGERED_SPEED}ms ease-out`;
    els.contentEl.style.transform = 'translateX(100%)';

    setActivationState(entityId, { direction: 'right', phase: 'triggered' });

    setTimeout(() => {
      setActivationState(entityId, { direction: 'right', phase: 'collapsing' });
      setTimeout(() => {
        onSwipeRight(entityId);
        setActivationState(entityId, { direction: 'right', phase: 'complete' });
      }, COLLAPSE_SPEED);
    }, TRANSLATE_AFTER_TRIGGERED_SPEED);
  };

  const handleSwipeLeft = async (entityId: string) => {
    const els = touchState.elements;
    if (!els) return;
    const onSwipeLeft = props.onSwipeLeft;
    if (!onSwipeLeft) return;

    els.contentEl.style.transition = `transform ${TRANSLATE_AFTER_TRIGGERED_SPEED}ms ease-out`;
    els.contentEl.style.transform = 'translateX(-100%)';

    setActivationState(entityId, { direction: 'left', phase: 'triggered' });

    setTimeout(() => {
      setActivationState(entityId, { direction: 'left', phase: 'collapsing' });
      setTimeout(() => {
        onSwipeLeft(entityId);
        setActivationState(entityId, { direction: 'left', phase: 'complete' });
      }, COLLAPSE_SPEED);
    }, TRANSLATE_AFTER_TRIGGERED_SPEED);
  };

  const canSwipeRight = (entityId: string) => {
    if (!props.onSwipeRight) return false;
    return props.canSwipeRight ? props.canSwipeRight(entityId) : true;
  };
  const canSwipeLeft = (entityId: string) => {
    if (!props.onSwipeLeft) return false;
    return props.canSwipeLeft ? props.canSwipeLeft(entityId) : true;
  };

  const onTouchStart = (e: TouchEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const swipeEl = target.closest('[data-swipe-surface]');
    if (!(swipeEl instanceof HTMLDivElement)) return;

    const rowEl = swipeEl.closest('[data-swipe-row]');
    if (!(rowEl instanceof HTMLDivElement)) return;

    const entityId = rowEl.dataset.swipeEntityId;
    if (!entityId) return;

    const contentEl = swipeEl.querySelector('[data-swipe-content]');
    if (!(contentEl instanceof HTMLDivElement)) return;

    const leftRevealEl = rowEl.querySelector('[data-left-reveal]');
    const rightRevealEl = rowEl.querySelector('[data-right-reveal]');

    const allowRight = canSwipeRight(entityId);
    const allowLeft = canSwipeLeft(entityId);
    if (!allowRight && !allowLeft) return;

    const phase = activationStateById()[entityId]?.phase ?? 'idle';
    if (phase === 'triggered' || phase === 'collapsing') return;

    const touch = e.touches[0];

    // Clear any existing transition immediately on touch start.
    contentEl.style.transition = '';

    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isSwipeGesture: null,
      entityId,
      elements: {
        rowEl,
        swipeEl,
        contentEl,
        leftRevealEl,
        rightRevealEl,
      },
    };
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!touchState.elements || !touchState.entityId) return;
    if (
      isAtLeastPhase(
        activationStateById()[touchState.entityId]?.phase,
        'triggered'
      )
    ) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - touchState.startX;
    const dy = touch.clientY - touchState.startY;

    // Determine direction on first significant movement
    if (
      touchState.isSwipeGesture === null &&
      (Math.abs(dx) > DIRECTIONALITY_THRESHOLD ||
        Math.abs(dy) > DIRECTIONALITY_THRESHOLD)
    ) {
      touchState.isSwipeGesture = Math.abs(dx) > Math.abs(dy);
    }

    if (touchState.isSwipeGesture) {
      e.preventDefault();

      touchState.currentX = touch.clientX;

      const allowRight = canSwipeRight(touchState.entityId);
      const allowLeft = canSwipeLeft(touchState.entityId);

      // Constrain dx based on available callbacks
      let constrainedDx = dx;
      if (dx > 0 && !allowRight) {
        constrainedDx = dx * 0.1;
      } else if (dx < 0 && !allowLeft) {
        constrainedDx = dx * 0.1;
      }

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!touchState.elements) return;
        touchState.elements.contentEl.style.transform = `translateX(${constrainedDx}px)`;
        rafId = null;
      });

      // set activation state
      const phase = activationStateById()[touchState.entityId]?.phase ?? 'idle';
      const thesholdCrossed =
        (allowRight && dx > SWIPE_ACTIVATION_DISTANCE) ||
        (allowLeft && dx < -SWIPE_ACTIVATION_DISTANCE);

      if (thesholdCrossed) {
        if (phase !== 'threshold') {
          impactFeedback('light');
          setActivationState(touchState.entityId, {
            direction: dx > 0 ? 'right' : 'left',
            phase: 'threshold',
          });
        }
      } else {
        if (phase !== 'dragging') {
          impactFeedback('light');
          setActivationState(touchState.entityId, {
            direction: dx > 0 ? 'right' : 'left',
            phase: 'dragging',
          });
        }
      }

      // Auto-activate swipe if threshold is reached
      const containerWidth = touchState.elements.swipeEl.clientWidth;
      if (allowRight && dx > containerWidth * AUTO_ACTIVATION_PERCENTAGE) {
        handleSwipeRight(touchState.entityId);
      } else if (
        allowLeft &&
        dx < -containerWidth * AUTO_ACTIVATION_PERCENTAGE
      ) {
        handleSwipeLeft(touchState.entityId);
      }
    }
  };

  const onTouchEnd = (_e: TouchEvent) => {
    if (
      !touchState.elements ||
      !touchState.entityId ||
      !touchState.isSwipeGesture
    ) {
      resetTouchState();
      return;
    }
    if (
      isAtLeastPhase(
        activationStateById()[touchState.entityId]?.phase,
        'triggered'
      )
    ) {
      resetTouchState();
      return;
    }

    const deltaX = touchState.currentX - touchState.startX;

    const entityId = touchState.entityId;

    const allowRight = canSwipeRight(entityId);
    const allowLeft = canSwipeLeft(entityId);

    if (allowRight && deltaX > SWIPE_ACTIVATION_DISTANCE) {
      void handleSwipeRight(entityId);
    } else if (allowLeft && deltaX < -SWIPE_ACTIVATION_DISTANCE) {
      void handleSwipeLeft(entityId);
    } else {
      springBack();
    }

    resetTouchState();
  };

  const onTouchCancel = (_e: TouchEvent) => {
    springBack();
    resetTouchState();
  };

  createEffect(() => {
    const el = props.container();
    if (!el) return;

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });

    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    });
  });

  const ctx: SwipeGestureContextValue = {
    activationStateFor: (entityId) =>
      activationStateById()[entityId] ?? { phase: 'idle', direction: null },
  };

  return (
    <SwipeGestureContext.Provider value={ctx}>
      {props.children}
    </SwipeGestureContext.Provider>
  );
}

export function SwipeGestureRow(
  props: ParentProps<{
    entityId: string;
    LeftReveal?: JSX.Element;
    RightReveal?: JSX.Element;
    swipeLeftColor?: string;
    swipeRightColor?: string;
  }>
) {
  const ctx = useContext(SwipeGestureContext);
  if (!ctx) {
    throw new Error('SwipeGestureRow must be used within SwipeGestureProvider');
  }

  const activationState = createMemo(() =>
    ctx.activationStateFor(props.entityId)
  );

  return (
    <div
      data-swipe-row
      data-swipe-entity-id={props.entityId}
      class="w-full grid grid-cols-1 relative overflow-hidden transition-[grid-template-rows] duration-[250ms] ease-in-out"
      classList={{
        'bg-transparent': activationState()?.phase === 'idle',
        [props.swipeLeftColor ?? 'bg-edge-muted']:
          activationState()?.direction === 'left',
        [props.swipeRightColor ?? 'bg-edge']:
          activationState()?.direction === 'right',
        'grid-rows-[0fr]': isAtLeastPhase(
          activationState()?.phase,
          'collapsing'
        ),
        'grid-rows-[1fr]': !isAtLeastPhase(
          activationState()?.phase,
          'collapsing'
        ),
      }}
    >
      {/* Left Reveal */}
      <div
        class="absolute left-[10px] top-0 h-full w-[40px] flex items-center justify-center z-[1]"
        aria-hidden="true"
      >
        <div
          data-left-reveal
          class="transition-transform duration-300 ease-in-out"
          classList={{
            'scale-50': !isAtLeastPhase(activationState()?.phase, 'threshold'),
            'scale-100': isAtLeastPhase(activationState()?.phase, 'threshold'),
          }}
        >
          {props.LeftReveal}
        </div>
      </div>

      {/* Right Reveal */}
      <div
        class="absolute right-[10px] top-0 h-full w-[40px] flex items-center justify-center z-[1]"
        aria-hidden="true"
      >
        <div
          data-right-reveal
          class="transition-transform duration-300 ease-in-out"
          classList={{
            'scale-50': !isAtLeastPhase(activationState()?.phase, 'threshold'),
            'scale-100': isAtLeastPhase(activationState()?.phase, 'threshold'),
          }}
        >
          {props.RightReveal}
        </div>
      </div>

      {/* Swipe Surface */}
      <div
        data-swipe-surface
        class="relative min-h-0 z-[2] w-full select-none [touch-action:pan-y]"
      >
        {/* Swipe Content */}
        <div
          data-swipe-content
          class="w-full min-h-0 overflow-hidden flex items-center p-0 bg-panel"
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
