/**
 * A generated SDK operation lifecycle. Contains no arguments, URLs or response
 * data. A gated operation is `skipped` (answered without calling the API) or
 * `refused` (rejected), with no `started` before it.
 */
export type RequestActivity = {
  id: number;
  service: string;
  operation: string;
  status: 'started' | 'completed' | 'failed' | 'skipped' | 'refused';
};

/** What a gate decides for one operation; `undefined` lets it run. */
export type RequestVerdict =
  | undefined
  | { skip: { data: unknown } }
  | { refuse: string };

let nextId = 0;
let defaultObserver: ((event: RequestActivity) => void) | undefined;
let defaultGate:
  | ((operation: { service: string; operation: string }) => RequestVerdict)
  | undefined;

/** @internal Install runtime diagnostics before constructing SDK clients. */
export function setDefaultRequestObserver(
  observer: (event: RequestActivity) => void,
) {
  defaultObserver = observer;
}

/**
 * @internal Decide, before each generated API operation, whether it runs, is
 * answered with a stand-in result, or is refused. Install it before
 * constructing SDK clients.
 */
export function setDefaultRequestGate(
  gate: (operation: { service: string; operation: string }) => RequestVerdict,
) {
  defaultGate = gate;
}

/** @internal Observe generated API operations without changing arguments or results. */
export function observeSdk<T extends object>(
  sdk: T,
  service: string,
  observer?: (event: RequestActivity) => void,
): T {
  if (!observer && !defaultObserver && !defaultGate) return sdk;
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
        const verdict = defaultGate?.({ service, operation: key });
        if (verdict && 'refuse' in verdict) {
          notify({ ...event, status: 'refused' });
          throw new Error(verdict.refuse);
        }
        if (verdict && 'skip' in verdict) {
          notify({ ...event, status: 'skipped' });
          return { data: verdict.skip.data, error: undefined };
        }
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
