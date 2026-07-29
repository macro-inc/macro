export type LatestAsyncRequestQueue<Request> = (
  request: Request
) => Promise<void>;

type RequestEntry<Request> = {
  request: Request;
  callers: Caller[];
};

type Caller = {
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/**
 * Creates a single-flight queue that keeps only the latest request received
 * while the executor is active.
 *
 * Callers whose pending request is replaced settle with the replacement. A
 * request equal to the active or pending request reuses that execution.
 */
export function createLatestAsyncRequestQueue<Request>(
  executor: (request: Request) => Promise<void>,
  requestsAreEqual: (left: Request, right: Request) => boolean = Object.is
): LatestAsyncRequestQueue<Request> {
  let active: RequestEntry<Request> | undefined;
  let pending: RequestEntry<Request> | undefined;

  async function execute(entry: RequestEntry<Request>): Promise<void> {
    let failure: unknown;
    let failed = false;

    try {
      await executor(entry.request);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      active = undefined;

      if (pending) {
        active = pending;
        pending = undefined;
        void execute(active);
      }
    }

    for (const caller of entry.callers) {
      if (failed) {
        caller.reject(failure);
      } else {
        caller.resolve();
      }
    }
  }

  return function enqueue(request: Request): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const caller = { resolve, reject };

      if (!active) {
        active = { request, callers: [caller] };
        void execute(active);
        return;
      }

      if (requestsAreEqual(active.request, request)) {
        active.callers.push(caller);
        if (pending) {
          active.callers.push(...pending.callers);
          pending = undefined;
        }
        return;
      }

      if (pending) {
        pending.callers.push(caller);
        pending.request = request;
        return;
      }

      pending = { request, callers: [caller] };
    });
  };
}
