import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EmailSendIntent,
  emailSendLocked,
  fetchEmailSendStatus,
  readEmailSendIntents,
  settledSendAttempt,
  watchEmailSends,
} from '@queries/email/send-queue';
import { recordEmailSend, traceEmailSend } from '@queries/email/send-telemetry';
import type {
  EmailSendProgress,
  QueuedSend,
} from '../context/compose-capabilities';

function emailSendProgress(intent: EmailSendIntent): EmailSendProgress {
  const attempt = settledSendAttempt(intent);
  if (attempt?.status === 'SENT') return { state: 'sent' };
  if (
    attempt?.status === 'CANCELLED' ||
    (intent.cancellationRequested && !emailSendLocked(intent))
  )
    return { state: 'cancelled' };
  // Undo owns the outcome once requested; it reports its own result.
  if (intent.cancellationRequested) return { state: 'pending' };
  if (attempt?.status === 'DELIVERY_UNCONFIRMED')
    return { state: 'unconfirmed' };
  if (intent.phase === 'failed' || attempt?.status === 'FAILED')
    return { state: 'failed' };
  if (attempt?.status === 'ACCEPTED' && attempt.sendTime)
    return { state: 'accepted', undoUntil: attempt.sendTime };
  return { state: 'pending' };
}

/** The outbox drops a send only once it is sent, or when it restores a cancelled one. */
async function departedSendProgress(
  seen: EmailSendIntent | undefined,
  started: number
): Promise<EmailSendProgress> {
  if (!seen) return { state: 'untracked' };
  const attempt = await traceEmailSend(
    'status',
    seen.metadata.payload.input.attempt,
    () => fetchEmailSendStatus(seen.metadata.payload.input.attempt)
  );
  recordEmailSend(
    {
      operation: 'status',
      outcome: 'observed',
      status: attempt?.status,
      durationMs: performance.now() - started,
    },
    seen
  );
  if (attempt?.status === 'SENT') return { state: 'sent' };
  // A restored send was cancelled, or never reached the server.
  if (!attempt || attempt.status === 'CANCELLED') return { state: 'cancelled' };
  return { state: 'untracked' };
}

/** The outbox records the server's thread id when the server accepts the send. */
export function watchSentThread(
  send: QueuedSend,
  found: (threadId: string) => void
): () => void {
  let departing = false;
  let finished = false;
  let latestRead = 0;
  const finish = (threadId?: string | null) => {
    if (finished) return;
    finished = true;
    unsubscribe();
    if (threadId) found(threadId);
  };
  const read = async () => {
    if (finished || departing) return;
    // Only the newest read may act: an older one can predate a cancellation.
    const readNumber = ++latestRead;
    const intent = (await readEmailSendIntents()).find(
      (row) => row.uuid === send.sendAttemptId
    );
    if (finished || departing || readNumber !== latestRead) return;
    if (intent) {
      // A requested cancellation owns the outcome until delivery overrides it.
      const delivered = settledSendAttempt(intent)?.status === 'SENT';
      if (
        intent.resolvedThreadId &&
        (delivered || !intent.cancellationRequested)
      )
        finish(intent.resolvedThreadId);
      return;
    }
    // Another tab can deliver and retire the send before this one reads it.
    departing = true;
    const attempt = { attemptId: send.sendAttemptId, linkId: send.inboxId };
    let threadId: string | null | undefined;
    try {
      const status = await traceEmailSend('status', attempt, () =>
        fetchEmailSendStatus(attempt)
      );
      if (status?.status === 'SENT') threadId = status.threadId;
    } finally {
      finish(threadId);
    }
  };
  const unsubscribe = watchEmailSends(() =>
    fireAndForget(read(), 'email-compose')
  );
  fireAndForget(read(), 'email-compose');
  return () => finish();
}

export function watchEmailSendProgress(
  sendAttemptId: string,
  changed: (progress: EmailSendProgress) => void
): () => void {
  const started = performance.now();
  let last: EmailSendProgress | undefined;
  let seen: EmailSendIntent | undefined;
  let stopped = false;
  let disposed = false;
  let reading = false;
  let rerun = false;
  const stop = () => {
    stopped = true;
    unsubscribe();
  };
  const read = async () => {
    const intent = (await readEmailSendIntents()).find(
      (row) => row.uuid === sendAttemptId
    );
    if (stopped) return;
    // Another tab can retire or restore the send before this one reads it.
    if (!intent) {
      stop();
      let progress: EmailSendProgress = { state: 'untracked' };
      try {
        progress = await departedSendProgress(seen, started);
      } finally {
        if (!disposed) changed(progress);
      }
      return;
    }
    seen = intent;
    const progress = emailSendProgress(intent);
    if (last && deepEqual(last, progress)) return;
    last = progress;
    if (progress.state !== 'pending' && progress.state !== 'accepted')
      recordEmailSend(
        {
          operation: 'status',
          outcome: 'observed',
          status: settledSendAttempt(intent)?.status,
          durationMs: performance.now() - started,
        },
        intent
      );
    if (
      progress.state === 'sent' ||
      progress.state === 'failed' ||
      progress.state === 'cancelled'
    )
      stop();
    changed(progress);
  };
  const drain = async () => {
    reading = true;
    try {
      do {
        rerun = false;
        await read();
      } while (rerun && !stopped);
    } finally {
      reading = false;
    }
  };
  const refresh = () => {
    if (stopped) return;
    if (reading) {
      rerun = true;
      return;
    }
    fireAndForget(drain(), 'email-compose');
  };
  const unsubscribe = watchEmailSends(refresh);
  refresh();
  return () => {
    disposed = true;
    stop();
  };
}
