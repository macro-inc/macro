/**
 * Orders render requests so the slide on screen never waits behind
 * thumbnails: interactive renders go to the engine immediately, background
 * renders one at a time and only while nothing interactive is in flight.
 * Background jobs that are no longer wanted when their turn comes are dropped.
 */

export interface RenderQueue {
  /** Runs now. */
  urgent: <T>(task: () => Promise<T>) => Promise<T>;
  /**
   * Runs when the engine is otherwise idle. `wanted` is checked just before
   * running; a job no longer wanted resolves to `undefined` without running.
   */
  background: <T>(
    task: () => Promise<T>,
    wanted?: () => boolean
  ) => Promise<T | undefined>;
}

export function createRenderQueue(): RenderQueue {
  let urgentInFlight = 0;
  let backgroundInFlight = 0;
  const waiting: Array<() => void> = [];

  const pump = () => {
    while (
      urgentInFlight === 0 &&
      backgroundInFlight === 0 &&
      waiting.length > 0
    ) {
      waiting.shift()?.();
    }
  };

  return {
    async urgent(task) {
      urgentInFlight++;
      try {
        return await task();
      } finally {
        urgentInFlight--;
        pump();
      }
    },
    background(task, wanted) {
      return new Promise((resolve, reject) => {
        waiting.push(() => {
          if (wanted && !wanted()) {
            resolve(undefined);
            return;
          }
          backgroundInFlight++;
          task()
            .then(resolve, reject)
            .finally(() => {
              backgroundInFlight--;
              pump();
            });
        });
        pump();
      });
    },
  };
}
