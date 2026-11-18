import type { Transition } from '@macro-inc/machine';
import { createSolidMachine } from '@macro-inc/machine/solid';
import { onCleanup } from 'solid-js';

const SKELETON_SHOW_DELAY_MS = 120;
const SKELETON_FRAME_LIMIT_MS = 34;
const SKELETON_MIN_VISIBLE_MS = 240;
// Matches the skeleton's duration-180 opacity transition.
const SKELETON_FADE_OUT_MS = 180;

type LoadingState =
  | { t: 'hidden' }
  | { t: 'waiting' }
  | { t: 'visible'; visibleSince: number; loading: boolean }
  | { t: 'leaving' };

type LoadingEvent =
  | { t: 'load-started'; now: number }
  | { t: 'load-finished' }
  | { t: 'delay-elapsed'; now: number }
  | { t: 'minimum-elapsed' }
  | { t: 'fade-elapsed' }
  | { t: 'reset' };

export type CalendarLoadingPhase = LoadingState['t'];

function transitionTo(
  state: LoadingState
): Transition<LoadingState, CalendarLoadingPhase> {
  return {
    state,
    commands: [state.t],
  };
}

/**
 * State scopes own timers, so interrupted loads cannot leave stale transitions.
 * `minimumVisibleMs` is how long a skeleton stays once shown; zero reveals the
 * events as soon as they arrive.
 */
export function createCalendarLoadingTransition(
  onPhaseChange?: (phase: CalendarLoadingPhase) => void,
  minimumVisibleMs = SKELETON_MIN_VISIBLE_MS
) {
  const machine = createSolidMachine<
    LoadingState,
    LoadingEvent,
    CalendarLoadingPhase
  >({
    initial: { t: 'hidden' },
    def: {
      hidden: {
        on: (_state, event) => {
          if (event.t === 'load-started') {
            return transitionTo({ t: 'waiting' });
          }

          if (event.t === 'reset') {
            return transitionTo({ t: 'hidden' });
          }
        },
      },
      waiting: {
        on: (_state, event) => {
          const shouldHide = event.t === 'load-finished' || event.t === 'reset';

          if (shouldHide) {
            return transitionTo({ t: 'hidden' });
          }

          if (event.t === 'delay-elapsed') {
            return transitionTo({
              t: 'visible',
              visibleSince: event.now,
              loading: true,
            });
          }
        },
      },
      visible: {
        on: (state, event) => {
          if (event.t === 'reset') {
            return transitionTo({ t: 'hidden' });
          }

          if (event.t === 'load-started' && !state.loading) {
            return { state: { ...state, loading: true } };
          }

          if (event.t === 'load-finished' && state.loading) {
            return { state: { ...state, loading: false } };
          }

          if (event.t === 'minimum-elapsed' && !state.loading) {
            return transitionTo({ t: 'leaving' });
          }
        },
      },
      leaving: {
        on: (_state, event) => {
          if (event.t === 'load-started') {
            return transitionTo({
              t: 'visible',
              visibleSince: event.now,
              loading: true,
            });
          }

          const shouldHide = event.t === 'fade-elapsed' || event.t === 'reset';

          if (shouldHide) {
            return transitionTo({ t: 'hidden' });
          }
        },
      },
    },
    scopes: {
      waiting: (_state, dispatch) => {
        let frame: number;
        let waitedMs = 0;
        let lastFrameAt: number | undefined;

        // The delay counts frames, each for at most SKELETON_FRAME_LIMIT_MS.
        // Mounting a grid can hold the thread past the whole delay while the
        // answer waits behind it; counted as one frame, that answer still
        // finishes the load before the skeleton can appear.
        const countFrame = (now: number) => {
          if (lastFrameAt !== undefined) {
            waitedMs += Math.min(now - lastFrameAt, SKELETON_FRAME_LIMIT_MS);
          }
          lastFrameAt = now;

          if (waitedMs >= SKELETON_SHOW_DELAY_MS) {
            dispatch({ t: 'delay-elapsed', now: Date.now() });
            return;
          }

          frame = requestAnimationFrame(countFrame);
        };

        frame = requestAnimationFrame(countFrame);

        return () => cancelAnimationFrame(frame);
      },
      visible: (state, dispatch) => {
        if (state.loading) {
          return;
        }

        const elapsedMs = Date.now() - state.visibleSince;
        const remainingMs = Math.max(0, minimumVisibleMs - elapsedMs);

        // Always a task later: FullCalendar lays out the events being revealed.
        const timer = setTimeout(
          () => dispatch({ t: 'minimum-elapsed' }),
          remainingMs
        );

        return () => clearTimeout(timer);
      },
      leaving: (_state, dispatch) => {
        const timer = setTimeout(
          () => dispatch({ t: 'fade-elapsed' }),
          SKELETON_FADE_OUT_MS
        );

        return () => clearTimeout(timer);
      },
    },
    execute: (phase) => onPhaseChange?.(phase),
  });

  function reset() {
    machine.dispatch({ t: 'reset' });
  }

  function setLoading(loading: boolean) {
    if (!loading) {
      return machine.dispatch({ t: 'load-finished' });
    }

    const now = Date.now();

    return machine.dispatch({ t: 'load-started', now });
  }

  // Solid runs cleanups in reverse order: reset before the machine is disposed.
  onCleanup(reset);

  return {
    phase: () => machine.state().t,
    setLoading,
    reset,
  };
}
