/**
 * Web Locks for the pages of one simulated device. A page that reloads drops
 * every lock it held, as a real document does when it goes away.
 */
export function createLocks() {
  const held = new Map<string, object>();
  return {
    /** The lock manager one page sees as `navigator.locks`. */
    forPage(page: object): Pick<LockManager, 'request'> {
      return {
        async request(name: string, ...rest: unknown[]) {
          const options = rest.length > 1 ? (rest[0] as LockOptions) : {};
          const callback = rest.at(-1) as (lock: Lock | null) => unknown;
          if (held.has(name)) {
            if (options.ifAvailable) return await callback(null);
            throw new Error(`${name} is held, and these locks never queue`);
          }
          held.set(name, page);
          try {
            return await callback({ name, mode: 'exclusive' });
          } finally {
            if (held.get(name) === page) held.delete(name);
          }
        },
      };
    },
    /** The page is gone: nothing it held is held any more. */
    release(page: object) {
      for (const [name, holder] of held) if (holder === page) held.delete(name);
    },
  };
}
