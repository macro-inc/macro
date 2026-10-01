import { scheduleIdle, throttle } from '@solid-primitives/scheduled';
import { onCleanup } from 'solid-js';

/** Coalesces keyed render work and yields between jobs. */
export function createRenderQueue() {
  const jobs = new Map<string, { run: () => void; urgent: boolean }>();
  const runNext = () => {
    const next =
      [...jobs].find(([, job]) => job.urgent) ?? jobs.entries().next().value;
    if (!next) return;
    const [key, job] = next;
    jobs.delete(key);
    try {
      job.run();
    } finally {
      // The scheduler resets its throttled flag after the callback returns.
      queueMicrotask(() => {
        if (jobs.size > 0) schedule();
      });
    }
  };
  // Idle callbacks let controls paint first. A bounded timeout also services
  // hidden/busy tabs. Safari gets a frame-length timer instead of idle work.
  const schedule =
    typeof requestIdleCallback === 'undefined'
      ? throttle(runNext, 16)
      : scheduleIdle(runNext, 50);

  const clear = () => {
    schedule.clear();
    jobs.clear();
  };
  onCleanup(clear);

  return {
    enqueue(key: string, run: () => void, urgent = false) {
      jobs.set(key, { run, urgent });
      schedule();
    },
    /** Imperative status for deciding whether another interaction can use queued work. */
    hasPending: () => jobs.size > 0,
    clear,
  };
}
