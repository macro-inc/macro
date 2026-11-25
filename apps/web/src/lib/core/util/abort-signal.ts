import {
  concat,
  fromValue,
  make,
  map,
  merge,
  pipe,
  type Source,
  take,
  toPromise,
} from 'wonka';

// `AbortSignal.any` needs Safari 17.4, newer than the webview floor in
// apps/web/package.json `browserslist`.

/**
 * Aborts with the first input's reason as soon as any input aborts. Listeners
 * on the inputs are removed only when the result aborts, so pair a long-lived
 * input with a short-lived one such as a timeout.
 */
export function anyAbortSignal(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
  }
  for (const signal of signals) {
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  }
  return controller.signal;
}

/**
 * Emits once the signal aborts. Racing an urql query against it unsubscribes
 * the query's operation, which a later read with the same key would otherwise
 * join and take its older answer from.
 */
export function abortedBy(signal: AbortSignal | undefined): Source<'aborted'> {
  return make((observer) => {
    if (!signal) return () => {};
    const abort = () => {
      observer.next('aborted');
      observer.complete();
    };
    if (signal.aborted) {
      abort();
      return () => {};
    }
    signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
  });
}

/** What `firstOrAborted` settled on. */
export type FirstOrAborted<T> =
  | { kind: 'value'; value: T }
  | { kind: 'ended' }
  | { kind: 'aborted' };

/**
 * The first value `source` emits, unless it ends without one or `signal`
 * aborts first. Settling leaves the source, so an urql query's request ends
 * when its signal aborts: urql replaces a `fetchOptions.signal` with its own.
 */
export function firstOrAborted<T>(
  source: Source<T>,
  signal: AbortSignal | undefined
): Promise<FirstOrAborted<T>> {
  return pipe(
    merge<FirstOrAborted<T>>([
      concat<FirstOrAborted<T>>([
        pipe(
          source,
          map((value) => ({ kind: 'value' as const, value }))
        ),
        fromValue({ kind: 'ended' as const }),
      ]),
      pipe(
        abortedBy(signal),
        map(() => ({ kind: 'aborted' as const }))
      ),
    ]),
    take(1),
    toPromise
  );
}

/**
 * Settles as `work` does, or rejects with `signal`'s reason as soon as it
 * aborts, whether or not `work` heeds the signal. What `work` settles on
 * after that is dropped.
 */
export async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  // Before the race: work that already settled would win it.
  signal.throwIfAborted();
  const settled = new AbortController();
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
      signal: settled.signal,
    });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    settled.abort();
  }
}
