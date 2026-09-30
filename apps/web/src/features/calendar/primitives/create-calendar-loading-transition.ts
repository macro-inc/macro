import type { Transition } from '@macro-inc/machine';
import { createSolidMachine } from '@macro-inc/machine/solid';
import { onCleanup } from 'solid-js';

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

const transitionTo = (
  state: LoadingState
): Transition<LoadingState, CalendarLoadingPhase> => ({
  state,
  commands: [state.t],
});

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
          if (event.t === 'load-started') return transitionTo({ t: 'waiting' });
          if (event.t === 'reset') return transitionTo({ t: 'hidden' });
        },
      },
      waiting: {
        on: (_state, event) => {
          if (event.t === 'load-finished' || event.t === 'reset') {
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
          if (event.t === 'reset') return transitionTo({ t: 'hidden' });
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
          if (event.t === 'fade-elapsed' || event.t === 'reset') {
            return transitionTo({ t: 'hidden' });
          }
        },
      },
    },
    scopes: {
      waiting: (_state, dispatch) => {
        const timer = setTimeout(
          () => dispatch({ t: 'delay-elapsed', now: Date.now() }),
          120
        );
        return () => clearTimeout(timer);
      },
      visible: (state, dispatch) => {
        if (state.loading) return;
        const remaining = Math.max(0, 240 - (Date.now() - state.visibleSince));
        if (remaining === 0) {
          dispatch({ t: 'minimum-elapsed' });
          return;
        }
        const timer = setTimeout(
          () => dispatch({ t: 'minimum-elapsed' }),
          remaining
        );
        return () => clearTimeout(timer);
      },
      leaving: (_state, dispatch) => {
        const timer = setTimeout(() => dispatch({ t: 'fade-elapsed' }), 180);
        return () => clearTimeout(timer);
      },
    },
    execute: (phase) => onPhaseChange?.(phase),
  });

  // Solid runs cleanups in reverse order: reset before the machine is disposed.
  onCleanup(reset);
  function reset() {
    machine.dispatch({ t: 'reset' });
  }

  return {
    phase: () => machine.state().t,
    setLoading: (loading: boolean) =>
      machine.dispatch(
        loading
          ? { t: 'load-started', now: Date.now() }
          : { t: 'load-finished' }
      ),
    reset,
  };
}
