type Waiter = { grant: () => Promise<void> };

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
        const grant = async () => {
          lock.held = true;
          try {
            // A browser calls back in a later task, never inside `request`.
            await null;
            resolve(await granted());
          } catch (error) {
            reject(error);
          } finally {
            lock.held = false;
            void lock.waiters.shift()?.grant();
          }
        };
        if (!lock.held) {
          void grant();
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
