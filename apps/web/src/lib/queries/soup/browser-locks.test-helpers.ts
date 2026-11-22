type Waiter = { grant: () => void };

/**
 * Installs the Locks API as one browser gives it to all of its tabs: one
 * holder per name, waiters granted in the order they asked, and a waiter whose
 * signal aborts leaves the queue with an `AbortError`. Returns the restore.
 */
export function installBrowserLocks(): () => void {
  const names = new Map<string, { held: boolean; waiters: Waiter[] }>();
  const locks = {
    request(
      name: string,
      options: { signal?: AbortSignal },
      granted: () => Promise<void>
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const lock = names.get(name) ?? { held: false, waiters: [] };
        names.set(name, lock);
        const grant = () => {
          lock.held = true;
          Promise.resolve()
            .then(granted)
            .then(resolve, reject)
            .finally(() => {
              lock.held = false;
              lock.waiters.shift()?.grant();
            });
        };
        if (!lock.held) {
          grant();
          return;
        }
        const waiter = { grant };
        lock.waiters.push(waiter);
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
  return () => {
    if (original) Object.defineProperty(navigator, 'locks', original);
    else Reflect.deleteProperty(navigator, 'locks');
  };
}
