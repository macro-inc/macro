import {
  createMachine,
  type MachineDef,
  type Transition,
} from '@macro-inc/machine';
import { match } from 'ts-pattern';

export type MessageTarget = { threadId: string; messageId: string };
type NavigationState =
  | { t: 'idle' }
  | { t: 'loading'; target: MessageTarget }
  | { t: 'positioning'; target: MessageTarget }
  | { t: 'highlighting'; target: MessageTarget };
type Event =
  | { t: 'navigate'; target: MessageTarget }
  | { t: 'cancel' | 'loaded' | 'positioned' | 'finished' }
  | { t: 'highlight'; target: MessageTarget };

const sameTarget = (a: MessageTarget, b: MessageTarget) =>
  a.threadId === b.threadId && a.messageId === b.messageId;

function transition(
  state: NavigationState,
  event: Event
): Transition<NavigationState, never> | undefined {
  return match(event)
    .with({ t: 'navigate' }, ({ target }) => ({
      state: { t: 'loading', target } as const,
    }))
    .with({ t: 'cancel' }, () =>
      state.t === 'idle' ? undefined : { state: { t: 'idle' } as const }
    )
    .with({ t: 'loaded' }, () =>
      state.t === 'loading'
        ? { state: { t: 'positioning', target: state.target } as const }
        : undefined
    )
    .with({ t: 'positioned' }, () =>
      state.t === 'positioning'
        ? { state: { t: 'highlighting', target: state.target } as const }
        : undefined
    )
    .with({ t: 'highlight' }, ({ target }) =>
      state.t === 'idle' || sameTarget(state.target, target)
        ? { state: { t: 'highlighting', target } as const }
        : undefined
    )
    .with({ t: 'finished' }, () => ({ state: { t: 'idle' } as const }))
    .exhaustive();
}

const definition: MachineDef<NavigationState, Event> = {
  idle: { on: transition },
  loading: { on: transition },
  positioning: { on: transition },
  highlighting: { on: transition },
};

/** One deep link owns its loading, layout callback, and highlight lifetime. */
export function createTargetMessageNavigation(options: {
  load: (target: MessageTarget, signal: AbortSignal) => Promise<boolean>;
  position: (target: MessageTarget) => boolean;
  release: (target: MessageTarget) => void;
  highlightMs: number;
  onError: (error: unknown) => void;
}) {
  const machine = createMachine<NavigationState, Event>({
    initial: { t: 'idle' },
    def: definition,
    scopes: {
      loading: ({ target }, dispatch) => {
        const controller = new AbortController();
        async function loadTarget() {
          try {
            const found = await options.load(target, controller.signal);
            if (!controller.signal.aborted)
              dispatch({ t: found ? 'loaded' : 'finished' });
          } catch (error) {
            if (controller.signal.aborted) return;
            options.onError(error);
            dispatch({ t: 'finished' });
          }
        }
        void loadTarget();
        return () => controller.abort();
      },
      positioning: ({ target }, dispatch) => {
        const frame = requestAnimationFrame(() => {
          dispatch({ t: options.position(target) ? 'positioned' : 'finished' });
        });
        return () => cancelAnimationFrame(frame);
      },
      highlighting: ({ target }, dispatch) => {
        const timer = setTimeout(() => {
          options.release(target);
          dispatch({ t: 'finished' });
        }, options.highlightMs);
        return () => clearTimeout(timer);
      },
    },
  });
  return {
    navigate: (target: MessageTarget) =>
      machine.dispatch({ t: 'navigate', target }),
    highlight: (target: MessageTarget) =>
      machine.dispatch({ t: 'highlight', target }),
    syncTarget: (target: MessageTarget | undefined) => {
      const state = machine.getState();
      if (state.t !== 'idle' && (!target || !sameTarget(state.target, target)))
        machine.dispatch({ t: 'cancel' });
    },
    dispose: machine.dispose,
  };
}
