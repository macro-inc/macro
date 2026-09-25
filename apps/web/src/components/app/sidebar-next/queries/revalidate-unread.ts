import { isTabFocused } from '@core/signal/tabFocus';
import { createEffect, on } from 'solid-js';

/**
 * The shortest gap between two focus-driven re-reads. Long enough that
 * clicking between windows cannot turn the dots into a poll, short enough
 * that coming back from another device's mail app clears a dot right away.
 */
const MIN_REVALIDATION_INTERVAL_MS = 60_000;

type RevalidatableQuery = {
  readonly isFetching: boolean;
  refetch(): Promise<void>;
};

/**
 * Re-reads every dot's page from the network, skipping queries already in
 * flight. A transport failure leaves the previous evidence on screen; the
 * next focus tries again.
 */
export async function revalidateUnread(
  queries: readonly RevalidatableQuery[]
): Promise<void> {
  await Promise.allSettled(
    queries
      .filter((query) => !query.isFetching)
      .map(async (query) => await query.refetch())
  );
}

/**
 * Re-reads the unread dots' evidence when the tab regains focus.
 *
 * Those queries mount with the app shell and never unmount, so TanStack's
 * mount refetch and urql's cache-and-network fetch each run once per session.
 * Mail read and done state also changes where this tab cannot see it — in
 * Gmail, on a phone, in another Macro window — and none of those push
 * anything back, so the page the dot was computed from can describe a mailbox
 * that no longer exists. Without this the dot stays lit until a reload.
 */
export function createUnreadRevalidation(revalidate: () => void): void {
  let lastRevalidatedAt = Date.now();
  createEffect(
    on(
      isTabFocused,
      (focused) => {
        if (!focused) return;
        const now = Date.now();
        if (now - lastRevalidatedAt < MIN_REVALIDATION_INTERVAL_MS) return;
        lastRevalidatedAt = now;
        revalidate();
      },
      { defer: true }
    )
  );
}
