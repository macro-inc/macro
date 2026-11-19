import { createSignal } from 'solid-js';

/** One owner-issued response generation shared by every query and cache writer. */
export function createSessionGeneration() {
  const [state, setState] = createSignal<{ epoch: string; paused: boolean }>({
    epoch: crypto.randomUUID(),
    paused: false,
  });
  let transitions = Promise.resolve();
  let initialized = false;
  const listeners = new Set<() => void>();
  const isCurrent = (captured: string) =>
    !state().paused && captured === state().epoch;

  return {
    state,
    /** Establish the local owner baseline before mounting request producers. */
    initialize(generation: string) {
      if (initialized) {
        if (state().epoch !== generation)
          throw new Error('Cache session generation was already initialized');
        return;
      }
      initialized = true;
      setState({ epoch: generation, paused: false });
    },
    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    capture: () => state().epoch,
    isCurrent,
    transition(
      retire: () => Promise<void>,
      generation: string = crypto.randomUUID()
    ): Promise<void> {
      initialized = true;
      const captured = generation;
      setState({ epoch: generation, paused: true });
      for (const listener of listeners) listener();
      const transition = transitions.then(async () => {
        await retire();
        if (captured === state().epoch) {
          setState({ epoch: captured, paused: false });
          for (const listener of listeners) listener();
        }
      });
      // A failed retirement remains closed, but a later retry can finish it.
      transitions = transition.catch(() => {});
      return transition;
    },
  };
}

export const cacheSessionGeneration = createSessionGeneration();
