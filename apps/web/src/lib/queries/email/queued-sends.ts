import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { supersededSendRestoration } from './send-draft-lifecycle';
import {
  type EmailSendIntent,
  fetchEmailSendStatus,
  readEmailSendIntents,
  recoverEmailSendIntent,
  retireEmailSendIntent,
  settledSendAttempt,
  watchEmailSends,
} from './send-queue';

/** Owner-scoped observer; missed events are recovered by reading durable state. */
export function useQueuedEmailSends(enabled: () => boolean = () => true) {
  const [intents, setIntents] = createSignal<EmailSendIntent[]>([]);
  const [ready, setReady] = createSignal(false);
  let disposed = false;
  let generation = 0;
  const statuses = new Map<string, EmailSendAttemptFieldsFragment>();
  const applyStatus = (row: EmailSendIntent): EmailSendIntent => {
    const persisted = settledSendAttempt(row);
    const attempt =
      persisted?.status === 'CANCELLED' || persisted?.status === 'SENT'
        ? persisted
        : statuses.get(row.uuid);
    return attempt && !row.metadata.payload.restoring
      ? { ...row, response: { sendEmailMessage: { attempt } } }
      : row;
  };
  const refresh = async (reconcile = false) => {
    if (!enabled()) return;
    const current = ++generation;
    try {
      const rows = await readEmailSendIntents();
      if (disposed || current !== generation) return;
      const active: EmailSendIntent[] = [];
      for (const row of rows) {
        const resolved = applyStatus(row);
        if (
          (settledSendAttempt(resolved)?.status === 'SENT' ||
            (row.metadata.payload.restoring && row.phase === 'committed') ||
            (await supersededSendRestoration(row))) &&
          (await retireEmailSendIntent(row))
        ) {
          statuses.delete(row.uuid);
        } else active.push(resolved);
      }
      if (disposed || current !== generation) return;
      setIntents(active);
      setReady(true);
      if (reconcile && navigator.onLine) {
        await Promise.all(
          active.map(async (row) => {
            if (row.cacheMissing) {
              try {
                await recoverEmailSendIntent(row);
              } catch {
                /* Preserve the independent backup on uncertainty. */
              }
              return;
            }
            const known = statuses.get(row.uuid) ?? settledSendAttempt(row);
            if (
              row.metadata.payload.restoring ||
              row.locallyCancelled ||
              known?.status === 'CANCELLED' ||
              known?.status === 'SENT'
            )
              return;
            try {
              const attempt = await fetchEmailSendStatus(row);
              if (attempt && !disposed) {
                statuses.set(row.uuid, attempt);
                if (
                  attempt.status === 'SENT' &&
                  (await retireEmailSendIntent(row))
                ) {
                  statuses.delete(row.uuid);
                  setIntents((current) =>
                    current.filter((intent) => intent.uuid !== row.uuid)
                  );
                } else setIntents((current) => current.map(applyStatus));
              }
            } catch {
              /* Uncertainty must preserve the persisted lock. */
            }
          })
        );
      }
    } catch {
      if (!disposed)
        setReady(
          false
        ); /* Missing storage is uncertainty, not an empty queue. */
    }
  };
  onMount(() => {
    void refresh(true);
    const unsubscribe = enabled()
      ? watchEmailSends(() => {
          void refresh();
        })
      : () => {};
    const reconnect = () => {
      void refresh(true);
    };
    window.addEventListener('online', reconnect);
    const interval = setInterval(reconnect, 5_000);
    onCleanup(() => {
      disposed = true;
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener('online', reconnect);
    });
  });
  return { intents, ready, refresh };
}
