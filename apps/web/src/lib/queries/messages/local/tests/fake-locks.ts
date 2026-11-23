/**
 * Web Locks for one lock name at a time, shared and exclusive, as tabs see
 * them: requests are granted in order, `ifAvailable` answers null when the
 * lock cannot be granted at once, and a `signal` withdraws a waiting request.
 */
export function fakeLocks(): LockManager {
  type Waiter = {
    mode: LockMode;
    grant: () => void;
  };
  const held = new Map<string, { mode: LockMode; count: number }>();
  const queues = new Map<string, Waiter[]>();
  const grantable = (name: string, mode: LockMode) => {
    const current = held.get(name);
    if (!current || current.count === 0) return true;
    return mode === 'shared' && current.mode === 'shared';
  };
  const pump = (name: string) => {
    const queue = queues.get(name) ?? [];
    while (queue.length > 0 && grantable(name, queue[0].mode)) {
      queue.shift()?.grant();
    }
  };
  const request = (async (
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<unknown>,
    maybeCallback?: LockGrantedCallback<unknown>
  ) => {
    const options =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = (
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback
    ) as LockGrantedCallback<unknown>;
    const mode = options.mode ?? 'exclusive';
    const queue = queues.get(name) ?? [];
    queues.set(name, queue);
    const free = queue.length === 0 && grantable(name, mode);
    if (!free && options.ifAvailable) return callback(null);
    if (!free) {
      options.signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { mode, grant: resolve };
        queue.push(waiter);
        options.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(waiter);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(options.signal?.reason);
          pump(name);
        });
      });
    }
    const current = held.get(name);
    if (current && current.count > 0) current.count += 1;
    else held.set(name, { mode, count: 1 });
    try {
      return await callback({ name, mode } as Lock);
    } finally {
      const after = held.get(name);
      if (after) after.count -= 1;
      pump(name);
    }
  }) as LockManager['request'];
  return {
    request,
    query: async () => ({ held: [], pending: [] }),
  };
}
