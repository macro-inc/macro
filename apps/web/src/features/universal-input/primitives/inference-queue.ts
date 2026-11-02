import { fireAndForget } from '@core/util/fireAndForget';
import { throttle } from '@solid-primitives/scheduled';
import type { QueueObservation } from '../context/telemetry';

/** One request in flight; queued work always reads the newest eligible snapshot. */
export function createInferenceQueue<T>(options: {
  read: () => T | undefined;
  key: (input: T) => string;
  run: (input: T) => Promise<void>;
  observe?: (observation: QueueObservation) => void;
}) {
  let running = false;
  let queued = false;
  let disposed = false;
  let lastKey: string | undefined;
  let queuedAt = 0;
  let requests = 0;

  const run = async () => {
    if (disposed) return;
    const input = options.read();
    if (!input || options.key(input) === lastKey) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    queued = false;
    lastKey = options.key(input);
    options.observe?.({
      action: 'started',
      waitMs: Math.max(0, performance.now() - queuedAt),
      coalesced: Math.max(0, requests - 1),
    });
    requests = 0;
    try {
      await options.run(input);
    } finally {
      running = false;
      if (queued && !disposed) {
        queued = false;
        fireAndForget(run(), 'universal-input');
      }
    }
  };
  const schedule = throttle(() => fireAndForget(run(), 'universal-input'), 200);
  const clear = () => {
    if (requests) options.observe?.({ action: 'cleared', count: requests });
    requests = 0;
    queued = false;
    lastKey = undefined;
    schedule.clear();
  };
  return {
    enqueue(immediate = false) {
      queuedAt = performance.now();
      requests++;
      options.observe?.({ action: 'requested' });
      if (immediate) {
        schedule.clear();
        fireAndForget(run(), 'universal-input');
      } else schedule();
    },
    clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
