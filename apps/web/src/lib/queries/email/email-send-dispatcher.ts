import { fireAndForget } from '@core/util/fireAndForget';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import type {
  createLocalDraftStore,
  DraftStorageSession,
} from './local-draft-store';
import { type EmailSendIntent, usableEmailSendIntents } from './send-intent';

type Journal = Pick<
  ReturnType<typeof createLocalDraftStore>,
  'sends' | 'claimSend' | 'settleSend' | 'subscribe'
>;

/** One authenticated account owns this runner. Database leases coordinate tabs. */
export function createEmailSendDispatcher(options: {
  session: DraftStorageSession;
  journal: Journal;
  submit(
    intent: EmailSendIntent,
    signal: AbortSignal
  ): Promise<EmailSendAttemptFieldsFragment>;
  cancel(
    intent: EmailSendIntent,
    signal: AbortSignal
  ): Promise<EmailSendAttemptFieldsFragment>;
  status(
    intent: EmailSendIntent,
    signal: AbortSignal
  ): Promise<EmailSendAttemptFieldsFragment | null>;
  report(intent: EmailSendIntent, error?: unknown): void;
}) {
  const worker = crypto.randomUUID();
  const controllers = new Set<AbortController>();
  const inFlight = new Map<string, Promise<void>>();
  let disposed = false;
  let running: Promise<void> | undefined;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = (row: EmailSendIntent) => {
    const status =
      row.response?.cancelEmailSend?.attempt.status ??
      row.response?.sendEmailMessage?.attempt.status;
    return (
      !row.dispatch?.paused &&
      !row.locallyCancelled &&
      status !== 'SENT' &&
      status !== 'CANCELLED' &&
      (row.cancellationRequested ||
        (row.phase !== 'failed' && status !== 'FAILED'))
    );
  };
  async function dispatch(row: EmailSendIntent) {
    const claimed = await options.journal.claimSend(
      options.session,
      row.uuid,
      worker,
      Date.now()
    );
    if (!claimed?.dispatch || disposed) return;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const leaseGeneration = claimed.dispatch.generation;
    try {
      let attempt: EmailSendAttemptFieldsFragment | null;
      if (claimed.cancellationRequested) {
        attempt = await options.cancel(claimed, controller.signal);
      } else if (row.submissionStarted || row.phase === 'committed') {
        attempt = await options.status(claimed, controller.signal);
        if (!attempt && row.phase !== 'committed')
          attempt = await options.submit(claimed, controller.signal);
        if (!attempt)
          throw new Error('Server acceptance could not be confirmed');
      } else {
        attempt = await options.submit(claimed, controller.signal);
      }
      if (disposed) return;
      await options.journal.settleSend(
        options.session,
        row.uuid,
        worker,
        leaseGeneration,
        {
          attempt,
          nextAttemptAt: Date.now() + 5_000,
        }
      );
      options.report(claimed);
    } catch (error) {
      if (disposed) return;
      const codes =
        error instanceof CombinedError
          ? error.graphQLErrors.map((entry) => entry.extensions.code)
          : [];
      const rejected = codes.some((code) =>
        [
          'INVALID',
          'INVALID_SENDER',
          'SEND_ATTEMPT_CONFLICT',
          'DRAFT_ALREADY_SENT',
          'DRAFT_VERSION_CONFLICT',
          'NOT_FOUND',
          'INBOX_NOT_FOUND',
          'FORBIDDEN',
        ].includes(String(code))
      );
      const needsAuthentication =
        codes.some((code) =>
          ['UNAUTHENTICATED', 'UNAUTHORIZED', 'NEEDS_REAUTH'].includes(
            String(code)
          )
        ) ||
        (error instanceof CombinedError && error.response?.status === 401);
      const backoff = Math.min(
        30_000,
        1_000 * 2 ** Math.min(claimed.dispatch.failures, 5)
      );
      const retryAfter =
        error instanceof CombinedError
          ? Number(error.response?.headers.get('retry-after')) * 1_000
          : 0;
      await options.journal.settleSend(
        options.session,
        row.uuid,
        worker,
        leaseGeneration,
        {
          failed: rejected && !claimed.cancellationRequested,
          // Only the first exclusive submission can prove that no earlier
          // request was accepted. A status rejection after a timeout cannot.
          rejectedBeforeAdmission:
            claimed.dispatchVersion === 2 &&
            leaseGeneration === 1 &&
            !row.submissionStarted &&
            row.phase !== 'committed' &&
            !claimed.cancellationRequested &&
            error instanceof CombinedError &&
            !error.networkError &&
            error.graphQLErrors.every(
              (entry) =>
                !entry.path ||
                (entry.path.length === 1 &&
                  entry.path[0] === 'sendEmailMessage')
            ) &&
            codes.length > 0 &&
            codes.every((code) =>
              ['INBOX_NOT_FOUND', 'FORBIDDEN'].includes(String(code))
            ),
          paused: needsAuthentication,
          error: needsAuthentication
            ? 'Reconnect your email account, then check status to resume.'
            : rejected
              ? 'Review this message before sending again.'
              : 'Waiting to confirm server acceptance.',
          nextAttemptAt:
            Date.now() +
            Math.max(retryAfter || 0, backoff * (0.8 + Math.random() * 0.4)),
        }
      );
      options.report(claimed, error);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function run() {
    try {
      const rows = usableEmailSendIntents(
        await options.journal.sends(options.session)
      ).filter(active);
      if (disposed) return;
      const now = Date.now();
      const due = rows.filter(
        (row) =>
          !inFlight.has(row.uuid) &&
          (row.dispatch?.leaseUntil ?? 0) <= now &&
          (row.dispatch?.nextAttemptAt ?? 0) <= now
      );
      // The journal also reserves each draft; unrelated drafts never share a
      // head-of-line queue. Limit concurrent HTTP work rather than ordering it.
      for (const row of due.slice(0, Math.max(0, 4 - inFlight.size))) {
        const task = dispatch(row).finally(() => {
          inFlight.delete(row.uuid);
          schedule();
        });
        inFlight.set(row.uuid, task);
        fireAndForget(task, 'email-outbox-attempt');
      }
    } finally {
      running = undefined;
      if (!disposed) {
        timer = setTimeout(schedule, rerun ? 0 : 1_000);
        rerun = false;
      }
    }
  }
  function wake() {
    if (disposed || navigator.onLine === false) return;
    if (timer !== undefined) clearTimeout(timer);
    if (running) rerun = true;
    else running = run();
    // Scan ownership ends before HTTP completes, so a newly approved message
    // can use a free slot while another request is slow. Await current work for
    // explicit callers; event-driven wakeups remain non-blocking.
    const completion = running.then(async () => {
      await Promise.allSettled([...inFlight.values()]);
    });
    return completion;
  }
  function schedule() {
    const completion = wake();
    if (completion) fireAndForget(completion, 'email-outbox');
  }
  const visibility = () => {
    if (document.visibilityState === 'visible') schedule();
  };
  const unsubscribe = options.journal.subscribe(schedule);
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', visibility);
  schedule();
  return {
    wake,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', visibility);
      for (const controller of controllers) controller.abort();
    },
  };
}
