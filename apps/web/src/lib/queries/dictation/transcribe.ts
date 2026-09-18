import { ThrownResultError, throwOnErr } from '@core/util/result';
import type { Span } from '@macro-inc/observability';
import {
  DictationCapacityError,
  transcribeDictation,
} from '@service-storage/dictation';
import { MutationObserver } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { dictationKeys } from './keys';

const CAPACITY_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 5_000;

function capacityError(error: unknown): DictationCapacityError | undefined {
  if (!(error instanceof ThrownResultError)) return;
  return error.errors.find(
    (error): error is DictationCapacityError =>
      error instanceof DictationCapacityError
  );
}

/** TanStack owns retries; recording and transcript stay out of mutation state. */
export async function transcribeAudio(
  audio: Blob,
  language: string,
  signal: AbortSignal,
  trace?: Pick<Span, 'run' | 'event'>
) {
  signal.throwIfAborted();
  let recording: Blob | undefined = audio;
  let transcript = '';
  let attempt = 0;
  // A fresh observer gives each recording its own retry policy and cancellation
  // scope. No mutation variables or data contain the audio or transcript.
  const mutation = new MutationObserver<void, Error, void>(queryClient, {
    mutationKey: dictationKeys.transcribe.queryKey,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: async () => {
      signal.throwIfAborted();
      if (!recording)
        throw new DOMException('Dictation cancelled', 'AbortError');
      const blob = recording;
      if (++attempt > 1) trace?.event('dictation.upload_retry', { attempt });
      const upload = () =>
        throwOnErr(() => transcribeDictation(blob, language, signal));
      const result = await (trace ? trace.run(upload) : upload());
      signal.throwIfAborted();
      transcript = result.text;
    },
    retry: (failureCount, error) => {
      const capacity = capacityError(error);
      return (
        !signal.aborted &&
        failureCount < CAPACITY_RETRIES &&
        capacity !== undefined &&
        capacity.retryAfterMs <= MAX_RETRY_AFTER_MS
      );
    },
    retryDelay: (attempt, error) =>
      Math.max(capacityError(error)?.retryAfterMs ?? 0, 1_000 * 2 ** attempt) +
      Math.floor(Math.random() * 250),
    // Detach after settlement so GC cannot repeatedly reschedule a pending
    // mutation while TanStack is waiting for its retry delay or browser focus.
    onSettled: (): void => mutation.reset(),
  });

  let onAbort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      recording = undefined;
      transcript = '';
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([mutation.mutate(), cancelled]);
    return transcript;
  } finally {
    signal.removeEventListener('abort', onAbort);
    recording = undefined;
    transcript = '';
  }
}
