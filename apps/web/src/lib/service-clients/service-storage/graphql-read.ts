import { createReadRequestSignal } from '@core/util/readRequestSignal';
import { HYDRATE_ONLY_CONTEXT_KEY } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  makeOperation,
  mapExchange,
  type OperationResult,
  type OperationResultSource,
} from '@urql/core';
import { filter, pipe, type Subscription, subscribe, take } from 'wonka';

/**
 * `toPromise()` that tears the operation down when `signal` aborts. urql
 * replaces `fetchOptions.signal` with its own controller, so a caller signal
 * passed there never reaches the request; tearing down makes urql abort it.
 */
export function toPromiseWithSignal<T extends OperationResult>(
  source: OperationResultSource<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return source.toPromise();
  return new Promise<T>((resolve, reject) => {
    let subscription: Subscription | undefined;
    const onAbort = () => {
      subscription?.unsubscribe();
      reject(signal.reason);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    subscription = pipe(
      source,
      filter((result) => !result.stale && !result.hasNext),
      take(1),
      subscribe((result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      })
    );
    // Starting the operation can abort the signal before `subscription` exists.
    if (signal.aborted) subscription.unsubscribe();
  });
}

/**
 * Bounds foreground network queries with the shared read deadline and native
 * offline abort. Mutations keep their own delivery and replay policy (see
 * `withQueueRequestTimeout`). Background hydration is bounded by its caller:
 * a large page on a slow link can legitimately outlast a foreground deadline.
 */
export const readDeadlineExchange = mapExchange({
  onOperation(operation) {
    if (
      operation.kind !== 'query' ||
      operation.context[HYDRATE_ONLY_CONTEXT_KEY] === true
    ) {
      return operation;
    }
    const operationFetch = operation.context.fetch ?? globalThis.fetch;
    return makeOperation(operation.kind, operation, {
      ...operation.context,
      fetch: (input, init) =>
        operationFetch(input, {
          ...init,
          signal: createReadRequestSignal(init?.signal ?? undefined),
        }),
    });
  },
});
