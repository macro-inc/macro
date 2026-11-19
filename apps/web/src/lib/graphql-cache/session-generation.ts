import { perfMark } from '@app/observability/perf-marks';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import {
  startupAuthorityHint,
  UNKNOWN_CACHE_GENERATION,
} from './generation-mirror';

/** One owner-issued response generation shared by every query and cache writer. */
export function createSessionGeneration(
  initialGeneration = UNKNOWN_CACHE_GENERATION
) {
  let current = {
    epoch: initialGeneration,
    paused: false,
  };
  // Baseline correction changes the shared-write stamp, not the rendered
  // session. Only a real transition notifies reactive consumers.
  const [version, notify] = createSignal(0);
  const state = () => {
    version();
    return current;
  };
  const setState = (next: typeof current) => {
    current = next;
    notify((value) => value + 1);
  };
  let transitions = Promise.resolve();
  let initialized = false;
  let transitioned = false;
  const listeners = new Set<() => void>();
  const baselines = new Set<() => void>();
  const isCurrent = (captured: unknown) =>
    !state().paused &&
    (captured === current.epoch ||
      (!transitioned && captured === initialGeneration));

  return {
    state,
    /** Confirm a startup hint without delaying requests or first render. */
    initialize(generation: string) {
      if (initialized) {
        if (state().epoch !== generation)
          throw new Error('Cache session generation was already initialized');
        return;
      }
      initialized = true;
      const mirrorMatches = state().epoch === generation;
      perfMark('cache.generation-baseline', { mirrorMatches });
      const span = Telemetry.span('graphql.cache_generation_baseline');
      span.setAttr('cache.mirror_matches', mirrorMatches);
      span.end();
      if (!mirrorMatches) {
        current = { epoch: generation, paused: false };
        for (const listener of baselines) listener();
      }
    },
    /** Restart a stale socket once so future frames carry the owner stamp. */
    onBaseline(listener: () => void) {
      baselines.add(listener);
      return () => {
        baselines.delete(listener);
      };
    },
    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Dispatch snapshots must not subscribe their caller to later transitions.
    capture: () => current.epoch,
    isCurrent,
    /** Existing local cleanup only; never waits for a network permission proof. */
    settled: () => transitions,
    transition(
      retire: () => Promise<void>,
      generation: string = crypto.randomUUID()
    ): Promise<void> {
      initialized = true;
      transitioned = true;
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

export const cacheSessionGeneration = createSessionGeneration(
  startupAuthorityHint?.generation ?? UNKNOWN_CACHE_GENERATION
);
