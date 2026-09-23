import { ThrownResultError, throwOnErr } from '@core/util/result';
import type { Span } from '@macro-inc/observability';
import {
  DictationCapacityError,
  transcribeDictation,
} from '@service-storage/dictation';

const CAPACITY_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 5_000;
const JITTER_MS = 250;

function capacityError(error: unknown): DictationCapacityError | undefined {
  if (!(error instanceof ThrownResultError)) return;
  return error.errors.find(
    (error): error is DictationCapacityError =>
      error instanceof DictationCapacityError
  );
}

/** Wait out the server's Retry-After, but never less than exponential backoff. */
export function backoffMs(failureCount: number, retryAfterMs: number) {
  return (
    Math.max(retryAfterMs, 1_000 * 2 ** failureCount) +
    Math.floor(Math.random() * JITTER_MS)
  );
}

/** Reject as soon as the signal aborts, even if `pending` never settles. */
async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal) {
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function pause(durationMs: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await untilAborted(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, durationMs);
      }),
      signal
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upload one recording and return its transcript, retrying only while the
 * server reports capacity. The audio and the transcript live in this call and
 * nowhere else — no cache, no store, no observable state.
 */
export async function transcribeAudio(
  audio: Blob,
  language: string,
  signal: AbortSignal,
  trace?: Pick<Span, 'run' | 'event'>
) {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    if (attempt > 1) trace?.event('dictation.upload_retry', { attempt });
    const upload = () =>
      throwOnErr(() => transcribeDictation(audio, language, signal));
    try {
      const result = await untilAborted(
        trace ? trace.run(upload) : upload(),
        signal
      );
      signal.throwIfAborted();
      return result.text;
    } catch (error) {
      const capacity = capacityError(error);
      if (
        signal.aborted ||
        attempt > CAPACITY_RETRIES ||
        capacity === undefined ||
        capacity.retryAfterMs > MAX_RETRY_AFTER_MS
      )
        throw error;
      await pause(backoffMs(attempt - 1, capacity.retryAfterMs), signal);
    }
  }
}
