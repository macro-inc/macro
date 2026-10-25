import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  type EmailSendIntent,
  readEmailSendIntents,
  watchEmailSends,
} from './send-queue';
import { emailSendFailureKind, recordEmailSend } from './send-telemetry';

// One snapshot per document, so a surface that mounts after Send, such as the
// thread it opens, starts from what earlier surfaces already read.
const [intents, setIntents] = createSignal<EmailSendIntent[]>([]);
const [ready, setReady] = createSignal(false);
let generation = 0;
let storageFailureReported = false;
let observers = 0;
let stopObserving: (() => void) | undefined;

async function refresh() {
  const current = ++generation;
  try {
    const rows = await readEmailSendIntents();
    if (current !== generation) return;
    storageFailureReported = false;
    setIntents(rows);
    setReady(true);
  } catch (error) {
    if (current !== generation) return;
    if (!storageFailureReported) {
      storageFailureReported = true;
      recordEmailSend({
        operation: 'refresh',
        outcome: 'error',
        failureKind: emailSendFailureKind(error),
      });
    }
    setReady(false); /* Missing storage is uncertainty, not an empty queue. */
  }
}

const wake = () => fireAndForget(refresh(), 'email-queued-sends');

function observe() {
  const unsubscribe = watchEmailSends(wake);
  window.addEventListener('online', wake);
  const interval = setInterval(wake, 5_000);
  return () => {
    unsubscribe();
    clearInterval(interval);
    window.removeEventListener('online', wake);
  };
}

/** Read at sign-in so the first compose starts unlocked; another account's
 * sends never carry over. */
export function setQueuedSendSession(accountId: string | undefined) {
  generation++;
  storageFailureReported = false;
  setIntents([]);
  setReady(false);
  if (accountId) wake();
}

/** Shared outbox observer; missed events are recovered by reading durable state. */
export function useQueuedEmailSends() {
  onMount(() => {
    wake();
    if (observers++ === 0) stopObserving = observe();
    onCleanup(() => {
      if (--observers > 0) return;
      stopObserving?.();
      stopObserving = undefined;
    });
  });
  return { intents, ready, refresh };
}
