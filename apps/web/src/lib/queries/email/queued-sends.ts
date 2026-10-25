import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  type EmailSendIntent,
  readEmailSendIntents,
  watchEmailSends,
} from './send-queue';
import { emailSendFailureKind, recordEmailSend } from './send-telemetry';

/** Owner-scoped observer; missed events are recovered by reading durable state. */
export function useQueuedEmailSends(enabled: () => boolean = () => true) {
  const [intents, setIntents] = createSignal<EmailSendIntent[]>([]);
  const [ready, setReady] = createSignal(false);
  let disposed = false;
  let generation = 0;
  let storageFailureReported = false;
  const refresh = async () => {
    if (!enabled()) return;
    const current = ++generation;
    try {
      const rows = await readEmailSendIntents();
      if (disposed || current !== generation) return;
      storageFailureReported = false;
      setIntents(rows);
      setReady(true);
    } catch (error) {
      if (!disposed && current === generation && !storageFailureReported) {
        storageFailureReported = true;
        recordEmailSend({
          operation: 'refresh',
          outcome: 'error',
          failureKind: emailSendFailureKind(error),
        });
      }
      if (!disposed && current === generation)
        setReady(
          false
        ); /* Missing storage is uncertainty, not an empty queue. */
    }
  };
  onMount(() => {
    fireAndForget(refresh(), 'email-queued-sends');
    const unsubscribe = enabled()
      ? watchEmailSends(() => {
          fireAndForget(refresh(), 'email-queued-sends');
        })
      : () => {};
    const reconnect = () => {
      fireAndForget(refresh(), 'email-queued-sends');
    };
    window.addEventListener('online', reconnect);
    const interval = enabled() ? setInterval(reconnect, 5_000) : undefined;
    onCleanup(() => {
      disposed = true;
      unsubscribe();
      if (interval !== undefined) clearInterval(interval);
      window.removeEventListener('online', reconnect);
    });
  });
  return { intents, ready, refresh };
}
