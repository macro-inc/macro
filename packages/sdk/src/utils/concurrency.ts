/**
 * Map `items` through `fn` with at most `limit` calls in flight. Results keep
 * the order of `items`; the first rejection rejects the whole call.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `concurrency limit must be a positive integer, got ${limit}`,
    );
  }
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Runs calls at most a set number at a time. */
export type CallLimit = <R>(call: () => Promise<R>) => Promise<R>;

/**
 * Run at most `limit` calls at once; the rest wait their turn in the order
 * they were made.
 */
export function callLimit(limit: number): CallLimit {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `concurrency limit must be a positive integer, got ${limit}`,
    );
  }
  let running = 0;
  const waiting: (() => void)[] = [];
  // A finished call hands its slot straight to the next waiting call, so a
  // call made later never overtakes one already waiting.
  const turn = async () => {
    if (running < limit) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };
  return async (call) => {
    await turn();
    try {
      return await call();
    } finally {
      release();
    }
  };
}

/** `sdk` with every method call run through `limit`. */
export function limitCalls<T extends object>(sdk: T, limit: CallLimit): T {
  return new Proxy(sdk, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver);
      if (typeof key !== 'string' || typeof method !== 'function')
        return method;
      return (...args: unknown[]) =>
        limit(() => Reflect.apply(method, target, args));
    },
  });
}

let processSearchLimit: CallLimit | undefined;

/**
 * @internal Hold the searches of every client in this process to `limit` at
 * once, or lift the hold with `undefined`. Install it before constructing SDK
 * clients.
 */
export function setDefaultSearchLimit(limit: number | undefined) {
  processSearchLimit = limit === undefined ? undefined : callLimit(limit);
}

/** @internal `sdk` under the process's search limit, when one is set. */
export function withSearchLimit<T extends object>(sdk: T): T {
  return processSearchLimit ? limitCalls(sdk, processSearchLimit) : sdk;
}
