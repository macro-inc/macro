import { Telemetry } from '@macro-inc/observability';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { GenerationSource } from '../context/suggestions-source';
import { type RefreshState, refreshState } from '../core/generation';

/**
 * The Refresh control's state: what the server says, a request of its own
 * under way, and a clock that turns a cooldown into ready when it ends.
 * Undefined while the server hasn't said, or can't.
 */
export function createRefresh(source: GenerationSource) {
  const [now, setNow] = createSignal(new Date());
  const [asking, setAsking] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  const state = (): RefreshState | undefined => {
    const generation = source.generation();
    if (!generation) return undefined;
    if (asking()) return { kind: 'running' };

    return refreshState(generation, now());
  };

  // Nothing is polled during a cooldown: one timer ends it.
  createEffect(() => {
    const current = state();
    if (current?.kind !== 'cooldown') return;

    const timer = setTimeout(
      () => setNow(new Date()),
      Math.max(0, current.availableAt.getTime() - Date.now()) + 50
    );
    onCleanup(() => clearTimeout(timer));
  });

  return {
    state,
    /** The last request didn't get through. */
    failed,
    async refresh() {
      if (state()?.kind !== 'ready') return;

      setAsking(true);
      setFailed(false);
      try {
        await Telemetry.span('suggestions.regenerate', () =>
          source.regenerate()
        );
      } catch {
        setFailed(true);
      } finally {
        setNow(new Date());
        setAsking(false);
      }
    },
  };
}

export type Refresh = ReturnType<typeof createRefresh>;
