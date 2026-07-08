import { hapticImpact } from '@core/mobile/haptics';
import { isMobile } from '@core/mobile/isMobile';
import Spinner from '@phosphor/spinner.svg';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';

/** Movement (px) before a touch commits to a direction. Mirrors EntityRow. */
const DIRECTIONALITY_THRESHOLD = 5;
/** Finger-to-indicator damping while pulling. */
const PULL_RESISTANCE = 0.5;
/** Damped pull distance (px) past which releasing triggers a refresh. */
const PULL_THRESHOLD = 70;
/** Damped pull cap — overdragging stretches the indicator up to here. */
const PULL_MAX = 110;
/** Indicator badge diameter (px). Keep in sync with the size-9 class below. */
const INDICATOR_SIZE = 36;
/** Gap between the mobile chrome inset and the indicator's resting spot. */
const INDICATOR_REST_MARGIN = 8;
/** Retract transition length. Keep in sync with the duration-250 class below. */
const SETTLE_MS = 250;
/** Spin floor so near-instant refreshes still read as a completed refresh. */
const MIN_REFRESH_SPIN_MS = 400;

type PullPhase = 'idle' | 'pulling' | 'refreshing' | 'settling';

type PullGesture = {
  startX: number;
  startY: number;
  /** null until the gesture commits to a direction. */
  pulling: boolean | null;
};

/**
 * Pull-to-refresh for a touch scroll container: dragging down from the top
 * reveals a floating spinner badge that arms past a threshold and, once
 * released, spins until `onRefresh` settles. Renders nothing off mobile.
 *
 * Mount inside a `position: relative` wrapper of the scroll container. The
 * badge hides above the wrapper's top edge and drops to just below the
 * floating mobile chrome (`--mobile-content-inset-top`), so the list itself
 * never moves — which keeps the virtualizer's scroll math untouched.
 */
export function PullToRefresh(props: {
  scrollContainer: Accessor<HTMLElement | undefined>;
  onRefresh: () => Promise<unknown>;
}) {
  const [phase, setPhase] = createSignal<PullPhase>('idle');
  const [pull, setPull] = createSignal(0);

  let gesture: PullGesture | null = null;
  let settleTimer: number | undefined;
  onCleanup(() => window.clearTimeout(settleTimer));

  const retract = () => {
    setPhase('settling');
    setPull(0);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => setPhase('idle'), SETTLE_MS);
  };

  const triggerRefresh = () => {
    setPhase('refreshing');
    setPull(PULL_THRESHOLD);

    const minSpin = new Promise((resolve) =>
      window.setTimeout(resolve, MIN_REFRESH_SPIN_MS)
    );
    void Promise.allSettled([props.onRefresh(), minSpin]).then(retract);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!isMobile() || phase() !== 'idle') return;
    if (e.touches.length !== 1) return;

    const container = props.scrollContainer();
    if (!container || container.scrollTop > 0) return;

    const touch = e.touches[0];
    gesture = { startX: touch.clientX, startY: touch.clientY, pulling: null };
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!gesture) return;

    if (e.touches.length !== 1) {
      onTouchCancel();
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (gesture.pulling === null) {
      if (
        Math.abs(dx) < DIRECTIONALITY_THRESHOLD &&
        Math.abs(dy) < DIRECTIONALITY_THRESHOLD
      )
        return;

      // Only a downward, predominantly vertical drag becomes a pull —
      // anything else stays with native scrolling / the row swipe handlers.
      gesture.pulling = dy > Math.abs(dx);
      if (!gesture.pulling) {
        gesture = null;
        return;
      }
      setPhase('pulling');
    }

    // Own the gesture: the indicator tracks the finger instead of the list
    // scrolling (the container is already at its top).
    if (e.cancelable) e.preventDefault();

    const damped = Math.min(
      Math.max(dy - DIRECTIONALITY_THRESHOLD, 0) * PULL_RESISTANCE,
      PULL_MAX
    );
    const wasArmed = pull() >= PULL_THRESHOLD;
    setPull(damped);
    if (damped >= PULL_THRESHOLD !== wasArmed) hapticImpact('light');
  };

  const onTouchEnd = () => {
    if (!gesture) return;
    const wasPulling = gesture.pulling === true;
    gesture = null;
    if (!wasPulling) return;

    if (pull() >= PULL_THRESHOLD) triggerRefresh();
    else retract();
  };

  const onTouchCancel = () => {
    if (!gesture) return;
    const wasPulling = gesture.pulling === true;
    gesture = null;
    if (wasPulling) retract();
  };

  createEffect(() => {
    const el = props.scrollContainer();
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

  const progress = () => Math.min(pull() / PULL_THRESHOLD, 1);
  // Past the threshold the badge keeps drifting, but only by extra pixels —
  // the inset-relative travel is pinned at the resting spot.
  const overdrag = () => Math.max(0, pull() - PULL_THRESHOLD) * 0.5;
  const isRefreshing = () => phase() === 'refreshing';

  return (
    <Show when={isMobile()}>
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        aria-hidden
      >
        <div
          class={cn(
            'island flex size-9 items-center justify-center rounded-full',
            phase() !== 'pulling' &&
              'transition-[transform,opacity] duration-250 ease-out'
          )}
          style={{
            transform: `translateY(calc((var(--mobile-content-inset-top, 0px) + ${
              INDICATOR_REST_MARGIN + INDICATOR_SIZE
            }px) * ${progress()} + ${overdrag() - INDICATOR_SIZE}px))`,
            opacity: Math.min(progress() * 1.5, 1),
          }}
        >
          <Spinner
            class={cn('size-4.5', isRefreshing() && 'animate-spin')}
            style={
              isRefreshing()
                ? undefined
                : { transform: `rotate(${pull() * 3}deg)` }
            }
          />
        </div>
      </div>
    </Show>
  );
}
