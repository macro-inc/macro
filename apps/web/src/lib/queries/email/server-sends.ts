import { fireAndForget } from '@core/util/fireAndForget';
import { readPendingEmailSends } from '@service-storage/email-send';
import type { PendingEmailSendsQuery } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';

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

/** Shared by the app shell, composers and status panel; never grants send authority. */
function createServerSendObserver(accountId: string) {
  let disposed = false;
  let pages = 1;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  async function load() {
    try {
      if (navigator.onLine === false) return;
      controller = new AbortController();
      const signal = AbortSignal.any([
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
      setServerEmailSends([...collected.values()]);
      setHasMore(!!after);
      setError(undefined);
    } catch {
      if (!disposed)
        setError(
          'Could not refresh server delivery status. Previously confirmed sends are preserved.'
        );
    } finally {
      running = undefined;
      if (!disposed) timer = setTimeout(wake, 10_000);
    }
  }
  async function refresh() {
    if (disposed || running) return running;
    if (timer !== undefined) clearTimeout(timer);
    // Defer load so its synchronous early-return cannot race this assignment.
    running = Promise.resolve().then(load);
    return running;
  }
  const wake = () => fireAndForget(refresh(), 'email-server-sends');
  const visible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', visible);
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
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
