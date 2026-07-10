import { hapticImpact } from '@core/mobile/haptics';
import { cn } from '@ui';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  useContext,
} from 'solid-js';

const SWIPE_ACTIVATION_DISTANCE = 75; // Threshold, in pixels, of dx past which releasing touch will activate swipe gesture;
const DIRECTIONALITY_THRESHOLD = 5; // Threshold, in pixels, of either dx or dy, past which a gesture is considered "horizontal" or "vertical". Note: it is not obvious that these should both be the same value... we may want to experiment more.
const AUTO_ACTIVATION_PERCENTAGE = 0.75; // Percentage of container width past which the swipe gesture auto activates.

const TRANSLATE_AFTER_TRIGGERED_SPEED = 100; // ms;
const SPRING_BACK_SPEED = 250; // ms;
const COLLAPSE_SPEED = 250; // ms;

const ROW_PHASES = [
  'idle',
  'dragging',
  'threshold',
  'triggered',
  'collapsing',
  'complete',
] as const;

type RowPhase = (typeof ROW_PHASES)[number];

const ROW_PHASE_RANK: Record<RowPhase, number> = {
  idle: 0,
  dragging: 1,
  threshold: 2,
  triggered: 3,
  collapsing: 4,
  complete: 5,
};

const isAtLeastPhase = (phase: RowPhase, minInclusive: RowPhase) =>
  ROW_PHASE_RANK[phase] >= ROW_PHASE_RANK[minInclusive];

type SwipeDirection = 'left' | 'right' | null;

type SwipableRowState = {
  direction: SwipeDirection;
  phase: RowPhase;
};

type RowElements = {
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
  id: string | null;
  elements: RowElements | undefined;
};

type SwipableRowContextValue = {
  stateFor: (id: string) => SwipableRowState;
  clearState: (id: string) => void;
  collapseRow: (id: string) => Promise<void>;
  registerRowHandler: (
    id: string,
    handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void }
  ) => void;
  unregisterRowHandler: (id: string) => void;
};

export const SwipableRowContext = createContext<SwipableRowContextValue>();

export function SwipableRowProvider(
  props: ParentProps<{
    container: Accessor<HTMLElement | undefined>;
    canSwipeRight?: (entityId: string) => boolean;
    canSwipeLeft?: (entityId: string) => boolean;
    onSwipeRight?: (entityId: string) => void;
    onSwipeLeft?: (entityId: string) => void;
    /**
     * How a row animates once its swipe triggers. 'fly-out' (default)
     * translates the row off-screen, for actions that remove the row from
     * the list (e.g. mark done). 'spring-back' returns the row to rest, for
     * actions that keep it in place (e.g. reply to a message).
     */
    triggerBehavior?: 'fly-out' | 'spring-back';
    setCollapseEntity?: Setter<((id: string) => Promise<void>) | undefined>;
  }>
) {
  const [stateById, setStateById] = createSignal<
    Record<string, SwipableRowState>
  >(Object.create(null));

  const setState = (id: string, state: Partial<SwipableRowState>) => {
    setStateById((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...state },
    }));
  };
  const clearState = (id: string) => {
    setStateById((prev) => {
      const newState = { ...prev };
      delete newState[id];
      return newState;
    });
  };
  const customRowSwipeHandlers = new Map<
    string,
    { onSwipeLeft?: () => void; onSwipeRight?: () => void }
  >();

  let touchState: SwipeTouchState = {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwipeGesture: null,
    id: null,
    elements: undefined,
  };

  let rafId: number | null = null;

  const resetRowState = () => {
    const els = touchState.elements;
    const id = touchState.id;
    if (!els || !id) return;
    // if row has not been collapsed, reset its styling.
    setTimeout(() => {
      if (!isAtLeastPhase(stateById()[id]?.phase, 'collapsing')) {
        els.contentEl.style.transition = `transform ${SPRING_BACK_SPEED}ms ease-out`;
        els.contentEl.style.transform = 'translateX(0px)';
        setTimeout(() => {
          els.contentEl.style.transition = ``;
          clearState(id);
        }, SPRING_BACK_SPEED);
      }
    }, COLLAPSE_SPEED);
  };

  const resetTouchState = () => {
    touchState = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isSwipeGesture: null,
      id: null,
      elements: undefined,
    };
  };

  function springBack() {
    if (!touchState.elements || !touchState.id) return;
    const { contentEl } = touchState.elements;
    const entityId = touchState.id;
    contentEl.style.transition = `transform ${SPRING_BACK_SPEED}ms ease-out`;
    contentEl.style.transform = 'translateX(0px)';

    setTimeout(() => {
      contentEl.style.transition = '';
      setState(entityId, { direction: null, phase: 'idle' });
    }, SPRING_BACK_SPEED);
  }

  const collapseRow = (entityId: string): Promise<void> => {
    return new Promise((resolve) => {
      setState(entityId, { phase: 'collapsing' });
      setTimeout(() => {
        setState(entityId, { phase: 'complete' });
        resolve();
      }, COLLAPSE_SPEED);
    });
  };

  // Register/unregister the row-collapse hook with our parent (e.g. UnifiedListView).
  onMount(() => {
    props.setCollapseEntity?.(() => collapseRow);
    onCleanup(() => props.setCollapseEntity?.(() => undefined));
  });

  const handleSwipe = (id: string) => {
    const els = touchState.elements;
    if (!els) return;
    const direction = stateById()[id]?.direction;
    if (!direction) return;
    const defaultSwipeLeft = props.onSwipeLeft;
    const defaultSwipeRight = props.onSwipeRight;
    const swipeHandler =
      direction === 'left'
        ? (customRowSwipeHandlers.get(id)?.onSwipeLeft ??
          (defaultSwipeLeft ? () => defaultSwipeLeft(id) : undefined))
        : (customRowSwipeHandlers.get(id)?.onSwipeRight ??
          (defaultSwipeRight ? () => defaultSwipeRight(id) : undefined));
    if (!swipeHandler) return;

    // Cancel any pending animation frame
    if (rafId) cancelAnimationFrame(rafId);

    if (props.triggerBehavior === 'spring-back') {
      // The row stays in the list: return the content to rest and fire the
      // handler synchronously — still inside the touch gesture, so a
      // handler that focuses an input can open the iOS keyboard.
      els.contentEl.style.transition = `transform ${SPRING_BACK_SPEED}ms ease-out`;
      els.contentEl.style.transform = 'translateX(0px)';
      setState(id, { phase: 'triggered' });
      swipeHandler();
      setTimeout(() => {
        els.contentEl.style.transition = '';
        clearState(id);
      }, SPRING_BACK_SPEED);
      return;
    }

    els.contentEl.style.transition = `transform ${TRANSLATE_AFTER_TRIGGERED_SPEED}ms ease-out`;
    els.contentEl.style.transform = `translateX(${direction === 'left' ? '-100%' : '100%'})`;

    setState(id, { phase: 'triggered' });

    setTimeout(() => {
      swipeHandler();
    }, TRANSLATE_AFTER_TRIGGERED_SPEED);

    // If row has not been removed, reset it:
    setTimeout(() => {
      els.contentEl.style.transition = ``;
      els.contentEl.style.transform = 'translateX(0px)';
    }, COLLAPSE_SPEED);

    resetRowState();
  };

  const canSwipeRight = (id: string) => {
    if (customRowSwipeHandlers.get(id)?.onSwipeRight !== undefined) return true;
    if (!props.onSwipeRight) return false;
    return props.canSwipeRight ? props.canSwipeRight(id) : true;
  };
  const canSwipeLeft = (id: string) => {
    if (customRowSwipeHandlers.get(id)?.onSwipeLeft !== undefined) return true;
    if (!props.onSwipeLeft) return false;
    return props.canSwipeLeft ? props.canSwipeLeft(id) : true;
  };

  // Touches that begin inside a horizontally scrollable element (a code
  // block, a wide table) must pan that element, not swipe the row.
  const startsInHorizontalScroller = (
    target: Element,
    boundary: Element
  ): boolean => {
    let el: Element | null = target;
    while (el && el !== boundary) {
      if (
        el.scrollWidth > el.clientWidth &&
        /auto|scroll/.test(getComputedStyle(el).overflowX)
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  const onTouchStart = (e: TouchEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const swipeEl = target.closest('[data-swipe-surface]');
    if (!(swipeEl instanceof HTMLDivElement)) return;

    if (startsInHorizontalScroller(target, swipeEl)) return;

    const rowEl = swipeEl.closest('[data-swipe-row]');
    if (!(rowEl instanceof HTMLDivElement)) return;

    const id = rowEl.dataset.swipeId;
    if (!id) return;

    const contentEl = swipeEl.querySelector('[data-swipe-content]');
    if (!(contentEl instanceof HTMLDivElement)) return;

    const leftRevealEl = rowEl.querySelector('[data-left-reveal]');
    const rightRevealEl = rowEl.querySelector('[data-right-reveal]');

    const allowRight = canSwipeRight(id);
    const allowLeft = canSwipeLeft(id);
    if (!allowRight && !allowLeft) return;

    const phase = stateById()[id]?.phase ?? 'idle';
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
      id: id,
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
    if (!touchState.elements || !touchState.id) return;
    if (isAtLeastPhase(stateById()[touchState.id]?.phase, 'triggered')) {
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

      const allowRight = canSwipeRight(touchState.id);
      const allowLeft = canSwipeLeft(touchState.id);

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
      const phase = stateById()[touchState.id]?.phase ?? 'idle';
      const thesholdCrossed =
        (allowRight && dx > SWIPE_ACTIVATION_DISTANCE) ||
        (allowLeft && dx < -SWIPE_ACTIVATION_DISTANCE);

      if (thesholdCrossed) {
        if (phase !== 'threshold') {
          hapticImpact('light');
          setState(touchState.id, {
            direction: dx > 0 ? 'right' : 'left',
            phase: 'threshold',
          });
        }
      } else {
        if (phase !== 'dragging') {
          if (phase === 'threshold') {
            hapticImpact('light');
          }
          setState(touchState.id, {
            direction: dx > 0 ? 'right' : 'left',
            phase: 'dragging',
          });
        }
      }

      // Auto-activate swipe if threshold is reached
      const containerWidth = touchState.elements.swipeEl.clientWidth;
      if (allowRight && dx > containerWidth * AUTO_ACTIVATION_PERCENTAGE) {
        handleSwipe(touchState.id);
      } else if (
        allowLeft &&
        dx < -containerWidth * AUTO_ACTIVATION_PERCENTAGE
      ) {
        handleSwipe(touchState.id);
      }
    }
  };

  const onTouchEnd = (_e: TouchEvent) => {
    if (!touchState.elements || !touchState.id || !touchState.isSwipeGesture) {
      resetTouchState();
      return;
    }
    if (isAtLeastPhase(stateById()[touchState.id]?.phase, 'triggered')) {
      resetTouchState();
      return;
    }

    const deltaX = touchState.currentX - touchState.startX;

    const entityId = touchState.id;

    const allowRight = canSwipeRight(entityId);
    const allowLeft = canSwipeLeft(entityId);

    if (allowRight && deltaX > SWIPE_ACTIVATION_DISTANCE) {
      void handleSwipe(entityId);
    } else if (allowLeft && deltaX < -SWIPE_ACTIVATION_DISTANCE) {
      void handleSwipe(entityId);
    } else {
      springBack();
    }

    resetRowState();
    resetTouchState();
  };

  const onTouchCancel = (_e: TouchEvent) => {
    springBack();
    resetRowState();
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

  const ctx: SwipableRowContextValue = {
    stateFor: (id) => stateById()[id] ?? { phase: 'idle', direction: null },
    clearState: (id) => clearState(id),
    collapseRow: collapseRow,
    registerRowHandler: (id, handlers) => {
      customRowSwipeHandlers.set(id, handlers);
    },
    unregisterRowHandler: (id) => {
      customRowSwipeHandlers.delete(id);
    },
  };

  return (
    <SwipableRowContext.Provider value={ctx}>
      {props.children}
    </SwipableRowContext.Provider>
  );
}

/**
 * Container for swipe gesture capabilities on touch devices.
 */
export function SwipableRow(
  props: ParentProps<{
    id: string;
    /** Applied to the root row so callers can scope styles to data-swipe-* attributes. */
    class?: string;
    swipeRightRevealedComponent?: JSX.Element;
    swipeLeftRevealedComponent?: JSX.Element;
    swipeLeftColor?: string;
    swipeRightColor?: string;
    /**
     * Background class of the sliding content. Defaults to an opaque panel
     * background so the revealed layer stays hidden at rest. Pass
     * 'bg-transparent' when the row must not paint over decorations behind
     * it (e.g. thread rails); the reveal components then have to manage
     * their own visibility, since nothing covers them at rest.
     */
    rowBgClass?: string;
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
  }>
) {
  const ctx = useContext(SwipableRowContext);
  if (!ctx) {
    throw new Error('EntityRow must be used within EntityRowProvider');
  }

  const rowState = createMemo(() => ctx.stateFor(props.id));

  createEffect(() => {
    const { onSwipeLeft, onSwipeRight, id: entityId } = props;
    if (!onSwipeLeft && !onSwipeRight) return;
    ctx.registerRowHandler(entityId, { onSwipeLeft, onSwipeRight });
    onCleanup(() => ctx.unregisterRowHandler(entityId));
  });

  onCleanup(() => {
    ctx.clearState(props.id);
  });

  const swipePhase = () => rowState().phase;
  const swipeDirection = () => rowState().direction;
  const isSwipeInteracting = () => isAtLeastPhase(swipePhase(), 'dragging');

  return (
    <div
      data-swipe-row
      data-swipe-id={props.id}
      data-swipe-phase={swipePhase()}
      data-swipe-direction={swipeDirection() ?? undefined}
      data-swipe-interacting={isSwipeInteracting() ? '' : undefined}
      class={cn(
        'grow w-full grid grid-cols-1 relative overflow-hidden transition-[grid-template-rows] duration-250 ease-in-out',
        props.class,
        {
          'bg-transparent': swipePhase() === 'idle',
          [props.swipeLeftColor ?? 'bg-edge-muted']:
            swipeDirection() === 'left',
          [props.swipeRightColor ?? 'bg-edge']: swipeDirection() === 'right',
          'grid-rows-[0fr]': isAtLeastPhase(swipePhase(), 'collapsing'),
          'grid-rows-[1fr]': !isAtLeastPhase(swipePhase(), 'collapsing'),
        }
      )}
    >
      {/* Swipe Right Revealed Component */}
      <div
        class="absolute top-0 left-0 h-full flex items-center justify-center z-user-highlight"
        style={{
          width: `${SWIPE_ACTIVATION_DISTANCE}px`,
        }}
        aria-hidden="true"
      >
        <div
          data-left-reveal
          class={cn('transition-transform duration-300 ease-in-out', {
            'scale-50': !isAtLeastPhase(swipePhase(), 'threshold'),
            'scale-100': isAtLeastPhase(swipePhase(), 'threshold'),
          })}
        >
          {props.swipeRightRevealedComponent}
        </div>
      </div>

      {/* Swipe Left Revealed Component */}
      <div
        class="absolute top-0 right-0 h-full flex items-center justify-center z-user-highlight"
        style={{
          width: `${SWIPE_ACTIVATION_DISTANCE}px`,
        }}
        aria-hidden="true"
      >
        <div
          data-right-reveal
          class={cn('transition-transform duration-300 ease-in-out', {
            'scale-50': !isAtLeastPhase(swipePhase(), 'threshold'),
            'scale-100': isAtLeastPhase(swipePhase(), 'threshold'),
          })}
        >
          {props.swipeLeftRevealedComponent}
        </div>
      </div>

      {/* Swipe Surface */}
      <div
        data-swipe-surface
        class="relative min-h-0 size-full z-annotation-layer select-none [touch-action:pan-y]"
      >
        {/* Swipe Content */}
        <div
          data-swipe-content
          class={cn(
            'size-full min-h-0 overflow-hidden flex items-center p-0',
            props.rowBgClass ?? 'bg-panel'
          )}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
