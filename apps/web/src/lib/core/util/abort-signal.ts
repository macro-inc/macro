import { make, type Source } from 'wonka';

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
