/** A generated SDK operation lifecycle. Contains no arguments, URLs or response data. */
export type RequestActivity = {
  id: number;
  service: string;
  operation: string;
  status: 'started' | 'completed' | 'failed';
};

/**
 * @internal What a generated operation was given and, once it ends, what it
 * returned. Only the runtime's default observer sees it, never `onRequest`.
 */
export type RequestCall = {
  args: readonly unknown[];
  result?: unknown;
};

let nextId = 0;
let defaultObserver:
  | ((event: RequestActivity, call: RequestCall) => void)
  | undefined;

/** @internal Install runtime diagnostics before constructing SDK clients. */
export function setDefaultRequestObserver(
  observer: (event: RequestActivity, call: RequestCall) => void,
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
  const notify = (event: RequestActivity, call: RequestCall) => {
    for (const callback of [
      () => defaultObserver?.(event, call),
      () => observer?.(event),
    ]) {
      try {
        // Diagnostics must never fail the operation, including an async observer.
        void Promise.resolve(callback()).catch(() => {});
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
        notify({ ...event, status: 'started' }, { args });
        try {
          const result: unknown = await Reflect.apply(method, target, args);
          const failed =
            result !== null &&
            typeof result === 'object' &&
            'error' in result &&
            result.error != null;
          notify(
            { ...event, status: failed ? 'failed' : 'completed' },
            { args, result },
          );
          return result;
        } catch (error) {
          notify({ ...event, status: 'failed' }, { args });
          throw error;
        }
      };
    },
  });
}
