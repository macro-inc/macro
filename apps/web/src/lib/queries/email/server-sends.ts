import { anyAbortSignal } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { readPendingEmailSends } from '@service-storage/email-send';
import type { PendingEmailSendsQuery } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';
import { readEmailSendIntents, watchEmailSends } from './send-queue';

export type ServerEmailSend =
  PendingEmailSendsQuery['user']['pendingEmailSends']['attempts'][number];
const [serverEmailSends, setServerEmailSends] = createSignal<ServerEmailSend[]>(
  []
);
const [serverEmailSendsError, setError] = createSignal<string>();
const [hasMoreServerEmailSends, setHasMore] = createSignal(false);

export { hasMoreServerEmailSends, serverEmailSends, serverEmailSendsError };

let current: ReturnType<typeof createServerSendObserver> | undefined;
let owner: string | undefined;

export function setServerSendSession(accountId: string | undefined) {
  current?.dispose();
  current = undefined;
  owner = accountId;
  setServerEmailSends([]);
  setError(undefined);
  setHasMore(false);
  if (accountId) current = createServerSendObserver(accountId);
}
export const serverSendAccount = () => owner;
export const refreshServerEmailSends = async () => {
  await current?.refresh();
};
export const loadMoreServerEmailSends = async () => {
  await current?.more();
};

const MOVING_POLL_MS = 10_000;
/** How soon an idle, visible tab learns of a send from another device. */
const IDLE_POLL_MS = 60_000;

/**
 * A failed send waits on a person and a send due later on its time. An
 * unconfirmed one is reconciled by the server but can stay listed for good, so
 * it keeps the idle pace too.
 */
function isMoving(row: ServerEmailSend, now: number) {
  const { status, sendTime } = row.attempt;
  if (status === 'SENDING' || status === 'SENT') return true;
  if (status !== 'ACCEPTED') return false;
  return !sendTime || !(Date.parse(sendTime) > now + IDLE_POLL_MS);
}

/** Shared by the app shell, composers and status panel; never grants send authority. */
function createServerSendObserver(accountId: string) {
  let disposed = false;
  let moving = false;
  let failed = false;
  let journalRead = 0;
  // Unknown until the journal is read, so the first reads keep the fast pace.
  let localSends: number | undefined;
  let pages = 1;
  let running: Promise<void> | undefined;
  let rerun: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function load() {
    try {
      if (navigator.onLine === false) return;
      controller = new AbortController();
      const signal = anyAbortSignal([
        controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      const collected = new Map<string, ServerEmailSend>();
      let after: string | undefined;
      for (let page = 0; page < pages; page++) {
        const result = await readPendingEmailSends(after, signal);
        if (disposed || result.id !== accountId) return;
        for (const row of result.pendingEmailSends.attempts)
          collected.set(`${row.linkId}:${row.attempt.attemptId}`, row);
        after = result.pendingEmailSends.nextCursor ?? undefined;
        if (!after) break;
      }
      if (disposed) return;
      const now = Date.now();
      moving = [...collected.values()].some((row) => isMoving(row, now));
      setServerEmailSends([...collected.values()]);
      setHasMore(!!after);
      setError(undefined);
      failed = false;
    } catch {
      failed = true;
      if (!disposed)
        setError(
          'Could not refresh server delivery status. Previously confirmed sends are preserved.'
        );
    } finally {
      running = undefined;
      // A hidden tab reads again when it is shown, not on a timer.
      if (!disposed && document.visibilityState === 'visible')
        timer = setTimeout(
          wake,
          moving || failed || localSends !== 0 ? MOVING_POLL_MS : IDLE_POLL_MS
        );
      if (!disposed && localSends === undefined) journalChanged();
    }
  }
  /** Resolves after a read that started after this call, so callers see their change. */
  async function refresh(): Promise<void> {
    if (disposed) return;
    if (running) {
      rerun ??= (async () => {
        await running;
        rerun = undefined;
        await refresh();
      })();
      return rerun;
    }
    if (timer !== undefined) clearTimeout(timer);
    // Defer load so its synchronous early-return cannot race this assignment.
    running = Promise.resolve().then(load);
    return running;
  }
  const wake = () => {
    if (!running) fireAndForget(refresh(), 'email-server-sends');
  };
  const visible = () => {
    if (document.visibilityState === 'visible') wake();
    else if (timer !== undefined) clearTimeout(timer);
  };
  /** Sends queued by any tab of this browser; drafts share the journal and are ignored. */
  async function readLocalSends() {
    const read = ++journalRead;
    let count: number | undefined;
    try {
      count = (await readEmailSendIntents()).length;
    } catch {
      count = undefined;
    }
    if (disposed || read !== journalRead || count === localSends) return;
    const first = localSends === undefined;
    localSends = count;
    // The sign-in read is already under way, and showing a hidden tab reads.
    if ((!first || count !== 0) && document.visibilityState === 'visible')
      wake();
  }
  const journalChanged = () =>
    fireAndForget(readLocalSends(), 'email-server-sends');
  const stopWatchingJournal = watchEmailSends(journalChanged);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', visible);
  journalChanged();
  wake();
  return {
    refresh,
    async more() {
      pages++;
      await refresh();
    },
    dispose() {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
      stopWatchingJournal();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
