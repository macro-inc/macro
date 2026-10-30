import { fireAndForget } from '@core/util/fireAndForget';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import type {
  createLocalDraftStore,
  DraftStorageSession,
} from './local-draft-store';
import {
  type EmailSendIntent,
  emailSendAttemptStatus,
  usableEmailSendIntents,
} from './send-intent';

type Journal = Pick<
  ReturnType<typeof createLocalDraftStore>,
  'sends' | 'claimSend' | 'settleSend' | 'subscribe'
>;

type SendApi = {
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
};

type Settlement = Parameters<Journal['settleSend']>[4];

const REJECTION_CODES = [
  'INVALID',
  'INVALID_SENDER',
  'SEND_ATTEMPT_CONFLICT',
  'DRAFT_ALREADY_SENT',
  'DRAFT_VERSION_CONFLICT',
  'NOT_FOUND',
  'INBOX_NOT_FOUND',
  'FORBIDDEN',
];
const REAUTHENTICATION_CODES = [
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'NEEDS_REAUTH',
];

/** Cancels, confirms an earlier submission, or submits, as the claimed row needs. */
async function requestAttempt(
  api: SendApi,
  claimed: EmailSendIntent,
  row: EmailSendIntent,
  signal: AbortSignal
): Promise<EmailSendAttemptFieldsFragment> {
  if (claimed.cancellationRequested) return await api.cancel(claimed, signal);
  if (!row.submissionStarted && row.phase !== 'committed')
    return await api.submit(claimed, signal);
  let attempt = await api.status(claimed, signal);
  if (!attempt && row.phase !== 'committed')
    attempt = await api.submit(claimed, signal);
  if (!attempt) throw new Error('Server acceptance could not be confirmed');
  return attempt;
}

function errorCodes(error: unknown): string[] {
  return error instanceof CombinedError
    ? error.graphQLErrors.map((entry) => String(entry.extensions.code))
    : [];
}

/**
 * Only the first exclusive submission can prove that no earlier request was
 * accepted. A status rejection after a timeout cannot.
 */
function rejectedBeforeAdmission(
  error: unknown,
  codes: string[],
  claimed: EmailSendIntent,
  row: EmailSendIntent,
  leaseGeneration: number
): boolean {
  if (
    claimed.dispatchVersion !== 2 ||
    leaseGeneration !== 1 ||
    row.submissionStarted ||
    row.phase === 'committed' ||
    claimed.cancellationRequested
  )
    return false;
  if (!(error instanceof CombinedError) || error.networkError) return false;
  return (
    error.graphQLErrors.every(
      (entry) =>
        !entry.path ||
        (entry.path.length === 1 && entry.path[0] === 'sendEmailMessage')
    ) &&
    codes.length > 0 &&
    codes.every((code) => ['INBOX_NOT_FOUND', 'FORBIDDEN'].includes(code))
  );
}

function nextRetryAt(error: unknown, failures: number): number {
  const backoff = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));
  const retryAfter =
    error instanceof CombinedError
      ? Number(error.response?.headers.get('retry-after')) * 1_000
      : 0;
  return (
    Date.now() +
    Math.max(retryAfter || 0, backoff * (0.8 + Math.random() * 0.4))
  );
}

/** How a failed attempt settles: rejected, paused for reauthentication, or retried. */
function failedAttemptSettlement(
  error: unknown,
  claimed: EmailSendIntent,
  row: EmailSendIntent,
  lease: { generation: number; failures: number }
): Settlement {
  const codes = errorCodes(error);
  const rejected = codes.some((code) => REJECTION_CODES.includes(code));
  const needsAuthentication =
    codes.some((code) => REAUTHENTICATION_CODES.includes(code)) ||
    (error instanceof CombinedError && error.response?.status === 401);
  return {
    failed: rejected && !claimed.cancellationRequested,
    rejectedBeforeAdmission: rejectedBeforeAdmission(
      error,
      codes,
      claimed,
      row,
      lease.generation
    ),
    paused: needsAuthentication,
    error: needsAuthentication
      ? 'Reconnect your email account, then check status to resume.'
      : rejected
        ? 'Review this message before sending again.'
        : 'Waiting to confirm server acceptance.',
    nextAttemptAt: nextRetryAt(error, lease.failures),
  };
}

/** One authenticated account owns this runner. Database leases coordinate tabs. */
export function createEmailSendDispatcher(
  options: SendApi & {
    session: DraftStorageSession;
    journal: Journal;
    report(intent: EmailSendIntent, error?: unknown): void;
  }
) {
  const worker = crypto.randomUUID();
  const controllers = new Set<AbortController>();
  const inFlight = new Map<string, Promise<void>>();
  let disposed = false;
  let running: Promise<void> | undefined;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = (row: EmailSendIntent) => {
    const status = emailSendAttemptStatus(row);
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
      const attempt = await requestAttempt(
        options,
        claimed,
        row,
        controller.signal
      );
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
      await options.journal.settleSend(
        options.session,
        row.uuid,
        worker,
        leaseGeneration,
        failedAttemptSettlement(error, claimed, row, claimed.dispatch)
      );
      options.report(claimed, error);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function dispatchAndRelease(row: EmailSendIntent) {
    try {
      await dispatch(row);
    } finally {
      inFlight.delete(row.uuid);
      schedule();
    }
  }
  async function afterInFlight(scan: Promise<void>) {
    await scan;
    await Promise.allSettled([...inFlight.values()]);
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
        const task = dispatchAndRelease(row);
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
    return afterInFlight(running);
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
