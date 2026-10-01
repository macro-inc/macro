import type { Transition } from '@macro-inc/machine';
import { createSolidMachine } from '@macro-inc/machine/solid';
import { onCleanup } from 'solid-js';

const SKELETON_SHOW_DELAY_MS = 120;
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

/** State scopes own timers, so interrupted loads cannot leave stale transitions. */
export function createCalendarLoadingTransition(
  onPhaseChange?: (phase: CalendarLoadingPhase) => void
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
        const timer = setTimeout(
          () => dispatch({ t: 'delay-elapsed', now: Date.now() }),
          SKELETON_SHOW_DELAY_MS
        );

        return () => clearTimeout(timer);
      },
      visible: (state, dispatch) => {
        if (state.loading) {
          return;
        }

        const elapsedMs = Date.now() - state.visibleSince;
        const remainingMs = Math.max(0, SKELETON_MIN_VISIBLE_MS - elapsedMs);

        if (remainingMs === 0) {
          dispatch({ t: 'minimum-elapsed' });
          return;
        }

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
