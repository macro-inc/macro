import type { Source } from '@macro-inc/muppet/core/event';

// The hosted supervisor preloads the bridge only when its Muppet supports
// maintenance. Older images run and type-check the same behavior.
const bridge = (): unknown =>
  Reflect.get(globalThis, Symbol.for('macro.agent.runtime-maintenance'));

/** Reports the readiness already established by markHealthy. */
export const reportRuntimeReady = async (): Promise<void> => {
  const host = bridge();
  if (
    typeof host === 'object' &&
    host !== null &&
    'ready' in host &&
    typeof host.ready === 'function'
  )
    await host.ready();
};

/** Registers detached work through the host bridge, preserving its concurrency. */
export const trackMaintenanceTask = <T>(work: () => Promise<T>): Promise<T> => {
  const task = work();
  const host = bridge();
  if (
    typeof host === 'object' &&
    host !== null &&
    'track' in host &&
    typeof host.track === 'function'
  )
    host.track(task);
  return task;
};

/** Non-replayable sources leave the runtime ineligible for service-only updates. */
export const maintenanceSource = <T>(
  source: Source<T>,
  delivery: 'replayable' | 'dependent'
): Source<T> => Object.assign(source, { delivery });
