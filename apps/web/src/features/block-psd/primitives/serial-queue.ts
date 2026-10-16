/**
 * Runs async work one piece at a time, in the order it was queued: the
 * editor's edits, other people's changes, and saves must not interleave.
 */

export interface SerialQueue {
  /**
   * Queues work; resolves to its result, or `undefined` when it threw
   * (the error goes to `onError`).
   */
  run<T>(work: () => Promise<T>): Promise<T | undefined>;
  /** Resolves once everything queued so far has run. */
  idle(): Promise<void>;
}

export function createSerialQueue(
  onError: (error: unknown) => void
): SerialQueue {
  const tasks: (() => Promise<void>)[] = [];
  let running = false;
  const waiting: (() => void)[] = [];

  const drain = async () => {
    if (running) return;
    running = true;
    for (let task = tasks.shift(); task; task = tasks.shift()) await task();
    running = false;
    for (const resolve of waiting.splice(0)) resolve();
  };

  return {
    run<T>(work: () => Promise<T>) {
      return new Promise<T | undefined>((resolve) => {
        tasks.push(async () => {
          try {
            resolve(await work());
          } catch (error) {
            onError(error);
            resolve(undefined);
          }
        });
        void drain();
      });
    },
    idle() {
      if (!running && tasks.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
  };
}
