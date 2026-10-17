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
