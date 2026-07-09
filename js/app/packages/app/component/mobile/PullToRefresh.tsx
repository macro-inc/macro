import { hapticImpact } from '@core/mobile/haptics';
import { isMobile } from '@core/mobile/isMobile';
import Spinner from '@phosphor-icons/core/bold/spinner-bold.svg';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';

/** Movement (px) before a touch commits to a direction. Mirrors EntityRow. */
const DIRECTIONALITY_THRESHOLD = 5;
/** Finger-to-indicator damping while pulling. */
const PULL_RESISTANCE = 0.5;
/** Damped pull distance (px) past which releasing triggers a refresh. */
const PULL_THRESHOLD = 60;
/** Slope the overdrag damping settles at — deep overdrag keeps moving at
 * this fraction of the base rate instead of hitting a hard stop. */
const OVERDRAG_RESISTANCE = 0.25;
/** Damped px over which the overdrag resistance fades in: the pull's slope
 * eases from 1 down to OVERDRAG_RESISTANCE across roughly this distance,
 * so crossing the threshold has no felt kink. */
const OVERDRAG_FADE = 40;
/** Retract transition length (ms). */
const SETTLE_MS = 250;
/** Spin floor so near-instant refreshes still read as a completed refresh. */
const MIN_REFRESH_SPIN_MS = 200;

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
 * badge sits parked just below the floating mobile chrome
 * (`--mobile-content-inset-top`) and paints beneath the list; the pull
 * translates the scroll container down, and the opaque rows sliding away
 * are what reveal it. A transform leaves layout and scrollTop untouched,
 * so the virtualizer's scroll math is unaffected.
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

    const base = Math.max(dy - DIRECTIONALITY_THRESHOLD, 0) * PULL_RESISTANCE;
    // Exponential blend past the threshold: slope starts at 1 and eases
    // toward OVERDRAG_RESISTANCE, so the extra resistance fades in instead
    // of kicking in abruptly.
    const over = Math.max(base - PULL_THRESHOLD, 0);
    const damped =
      Math.min(base, PULL_THRESHOLD) +
      OVERDRAG_RESISTANCE * over +
      (1 - OVERDRAG_RESISTANCE) *
        OVERDRAG_FADE *
        (1 - Math.exp(-over / OVERDRAG_FADE));
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


  createEffect(
    on(props.scrollContainer, (el) => {
      if (!el) return;

      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
      el.addEventListener('touchcancel', onTouchCancel, { passive: true });

      // The list follows the finger: translate the scroll container by the
      // damped pull, tracking directly while pulling and easing back
      // otherwise (mirroring the badge's settle transition).
      createEffect(() => {
        el.style.transform = pull() > 0 ? `translateY(${pull()}px)` : '';
        el.style.transition =
          phase() === 'pulling' ? '' : `transform ${SETTLE_MS}ms ease-out`;
      });

      onCleanup(() => {
        el.style.transform = '';
        el.style.transition = '';
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchCancel);
      });
    })
  );

  const progress = () => Math.min(pull() / PULL_THRESHOLD, 1);
  const isRefreshing = () => phase() === 'refreshing';

  return (
    <Show when={isMobile()}>
      {/* No z-index: the badge paints beneath the list (later positioned
          sibling), so the opaque rows translating down are what reveal it. */}
      <div
        class="pointer-events-none absolute inset-x-0 flex justify-center"
        style={{
          top: 'var(--mobile-content-inset-top, 0px)',
        }}
        aria-hidden
      >
        <div
          class="flex items-center justify-center rounded-full"
          style={{
            opacity: Math.min(progress() * 1.5, 1),
            transition:
              phase() === 'pulling'
                ? undefined
                : `opacity ${SETTLE_MS}ms ease-out`,
          }}
        >
          <Spinner
            class={cn('size-7', isRefreshing() && 'animate-spin')}
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
