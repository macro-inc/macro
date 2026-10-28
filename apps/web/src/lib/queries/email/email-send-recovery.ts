import { fireAndForget } from '@core/util/fireAndForget';
import {
  readEmailSendIntents,
  restoreCancelledEmailSend,
  retireEmailSendIntent,
  settledSendAttempt,
  watchEmailSends,
} from './send-queue';
import { emailSendFailureKind, recordEmailSend } from './send-telemetry';

/** Finish durable Undo decisions even after the toast or composer has unmounted. */
export function createEmailSendRecovery(accountId: string) {
  let disposed = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failures = new Set<string>();
  async function recover() {
    try {
      const rows = await readEmailSendIntents();
      for (const row of rows) {
        if (disposed) return;
        if (row.dispatchVersion !== 2 || row.accountId !== accountId) continue;
        try {
          const status = settledSendAttempt(row)?.status;
          if (status === 'SENT') await retireEmailSendIntent(row);
          else if (
            row.cancellationRequested &&
            (status === 'CANCELLED' ||
              (row.locallyCancelled &&
                !row.metadata.requiresServerConfirmation))
          )
            await restoreCancelledEmailSend(row);
          failures.delete(row.uuid);
        } catch (error) {
          if (!failures.has(row.uuid)) {
            failures.add(row.uuid);
            recordEmailSend(
              {
                operation: 'restore',
                outcome: 'error',
                failureKind: emailSendFailureKind(error),
              },
              row
            );
          }
        }
      }
    } finally {
      running = undefined;
      if (!disposed) timer = setTimeout(wake, 5_000);
    }
  }
  function wake() {
    if (disposed || running) return;
    if (timer !== undefined) clearTimeout(timer);
    running = Promise.resolve().then(recover);
    fireAndForget(running, 'email-send-recovery');
  }
  const unsubscribe = watchEmailSends(wake);
  wake();
  return {
    dispose() {
      disposed = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
