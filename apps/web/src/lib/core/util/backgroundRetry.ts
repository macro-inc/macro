import { onlineManager } from '@tanstack/query-core';

const FIRST_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type BackgroundRetryOptions = {
  onError?: (error: unknown) => void;
  firstRetryDelayMs?: number;
  maxRetryDelayMs?: number;
};

/**
 * Waits `delayMs`, or less when the device comes back online or the app
 * becomes visible: an API outage can end without either event, and either
 * event is a good moment to try again sooner.
 */
async function waitForRetry(
  delayMs: number,
  signal: AbortSignal
): Promise<void> {
  let wake = () => {};
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const timer = setTimeout(wake, delayMs);
  const unsubscribeOnline = onlineManager.subscribe((online) => {
    if (online) wake();
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') wake();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  signal.addEventListener('abort', wake, { once: true });
  try {
    await woken;
  } finally {
    clearTimeout(timer);
    unsubscribeOnline();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    signal.removeEventListener('abort', wake);
  }
}

/**
 * Runs background work until it succeeds. Each failure retries after a delay
 * that doubles from 30 seconds up to five minutes, or sooner on reconnect or
 * foreground. The returned function cancels the current attempt and any
 * pending retry.
 */
export function runWithBackgroundRetry(
  task: (signal: AbortSignal) => Promise<void>,
  options: BackgroundRetryOptions = {}
): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const maxDelayMs = options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS;

  const run = async () => {
    let delayMs = options.firstRetryDelayMs ?? FIRST_RETRY_DELAY_MS;
    while (!signal.aborted) {
      try {
        await task(signal);
        return;
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
      }
      await waitForRetry(delayMs, signal);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  };
  void run();

  return () => abort.abort();
}
