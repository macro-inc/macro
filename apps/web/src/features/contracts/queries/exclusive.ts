/** Runs `work` while nothing else holding the same name is running. */
export type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

/** Wait for work to finish either way, so the next caller can start. */
async function settled(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The caller of the failed work reports it.
  }
}

/** One caller at a time within this page. */
export function createQueue(): Exclusive {
  let tail: Promise<void> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail;
    const next = (async () => {
      await previous;
      return work();
    })();
    tail = settled(next);
    return next;
  };
}

/**
 * One caller at a time across every tab of this browser, through a Web Lock
 * of this name. A browser without Web Locks still gets one caller at a time
 * within the page.
 */
export function createBrowserExclusive(name: string): Exclusive {
  if (!('locks' in navigator)) return createQueue();

  return async <T>(work: () => Promise<T>): Promise<T> =>
    // The lock is released when `work` settles; its outcome is the caller's.
    (await navigator.locks.request(name, work)) as T;
}
