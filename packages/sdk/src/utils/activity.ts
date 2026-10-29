/** A generated SDK operation lifecycle. Contains no arguments, URLs or response data. */
export type RequestActivity = {
  id: number;
  service: string;
  operation: string;
  status: 'started' | 'completed' | 'failed';
};

let nextId = 0;
let defaultObserver: ((event: RequestActivity) => void) | undefined;

/** @internal Install runtime diagnostics before constructing SDK clients. */
export function setDefaultRequestObserver(
  observer: (event: RequestActivity) => void,
) {
  defaultObserver = observer;
}

/** @internal Observe generated API operations without changing arguments or results. */
export function observeSdk<T extends object>(
  sdk: T,
  service: string,
  observer?: (event: RequestActivity) => void,
): T {
  if (!observer && !defaultObserver) return sdk;
  const notify = (event: RequestActivity) => {
    for (const callback of [defaultObserver, observer]) {
      try {
        // Diagnostics must never fail the operation, including an async observer.
        void Promise.resolve(callback?.(event)).catch(() => {});
      } catch {
        // A consumer's diagnostics callback cannot change an API outcome.
      }
    }
  };
  return new Proxy(sdk, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver);
      if (typeof key !== 'string' || typeof method !== 'function')
        return method;
      return async (...args: unknown[]) => {
        const event = { id: ++nextId, service, operation: key };
        notify({ ...event, status: 'started' });
        try {
          const result: unknown = await Reflect.apply(method, target, args);
          const failed =
            result !== null &&
            typeof result === 'object' &&
            'error' in result &&
            result.error != null;
          notify({ ...event, status: failed ? 'failed' : 'completed' });
          return result;
        } catch (error) {
          notify({ ...event, status: 'failed' });
          throw error;
        }
      };
    },
  });
}
