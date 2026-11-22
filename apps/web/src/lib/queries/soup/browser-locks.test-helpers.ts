import { fireAndForget } from '@core/util/fireAndForget';

type Granted = (lock: { name: string } | null) => Promise<void>;
type Waiter = { grant: () => Promise<void> };
type Name = {
  held: boolean;
  waiters: Waiter[];
  /** Resolved the next time a request starts waiting for this name. */
  onWait: (() => void)[];
};

export type BrowserLocks = {
  /** Resolves once a request for `name` waits for its current holder. */
  waiting: (name: string) => Promise<void>;
  restore: () => void;
};

/**
 * Installs the Locks API as one browser gives it to all of its tabs: one
 * holder per name, waiters granted in the order they asked, a waiter whose
 * signal aborts leaves the queue with an `AbortError`, and an `ifAvailable`
 * request for a held name is called back with null.
 */
export function installBrowserLocks(): BrowserLocks {
  const names = new Map<string, Name>();
  const named = (name: string) => {
    const lock = names.get(name) ?? { held: false, waiters: [], onWait: [] };
    names.set(name, lock);
    return lock;
  };
  const locks = {
    request(
      name: string,
      options: { signal?: AbortSignal; ifAvailable?: boolean },
      granted: Granted
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const lock = named(name);
        const answer = async (held: { name: string } | null) => {
          try {
            // A browser calls back in a later task, never inside `request`.
            await null;
            resolve(await granted(held));
          } catch (error) {
            reject(error);
          }
        };
        const grant = async () => {
          lock.held = true;
          await answer({ name });
          lock.held = false;
          const next = lock.waiters.shift();
          if (next) fireAndForget(next.grant(), 'test-browser-locks');
        };
        if (!lock.held) {
          fireAndForget(grant(), 'test-browser-locks');
          return;
        }
        if (options.ifAvailable) {
          fireAndForget(answer(null), 'test-browser-locks');
          return;
        }
        const waiter = { grant };
        lock.waiters.push(waiter);
        for (const notify of lock.onWait.splice(0)) notify();
        options.signal?.addEventListener(
          'abort',
          () => {
            const index = lock.waiters.indexOf(waiter);
            if (index < 0) return;
            lock.waiters.splice(index, 1);
            reject(new DOMException('The request was aborted.', 'AbortError'));
          },
          { once: true }
        );
      });
    },
  };
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    value: locks,
    configurable: true,
  });
  return {
    waiting: (name) =>
      new Promise<void>((resolve) => {
        const lock = named(name);
        if (lock.waiters.length > 0) resolve();
        else lock.onWait.push(resolve);
      }),
    restore: () => {
      if (original) Object.defineProperty(navigator, 'locks', original);
      else Reflect.deleteProperty(navigator, 'locks');
    },
  };
}
