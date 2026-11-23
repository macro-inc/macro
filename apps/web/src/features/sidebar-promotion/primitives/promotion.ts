import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { dismissPromptEverywhere } from '@queries/prompt-dismissals';
import { createSignal } from 'solid-js';

// Dismissals live on the server (see `@queries/prompt-dismissals`) so they
// follow the user across devices. This local mirror hides a card instantly,
// keeps it hidden while the server list loads or is unreachable, and keeps
// every mounted card in sync even when local storage is unavailable.
const [hiddenScopes, setHiddenScopes] = createSignal<ReadonlySet<string>>(
  new Set()
);

function storage(id: string) {
  return createUserScopedStorage(
    `sidebar-promotion:v1:${encodeURIComponent(id)}`
  );
}

function scope(userId: string, id: string): string {
  return JSON.stringify([userId, id]);
}

/** Whether this browser already knows `id` is dismissed for the user. */
export function isPromotionHiddenLocally(
  userId: string | undefined,
  id: string
): boolean {
  if (!userId) return false;
  return (
    hiddenScopes().has(scope(userId, id)) ||
    storage(id).read(userId) === 'hidden'
  );
}

/** Hide on this browser; false when it already was. */
function hideLocally(userId: string | undefined, id: string): boolean {
  if (!userId || isPromotionHiddenLocally(userId, id)) return false;
  storage(id).write(userId, 'hidden');
  setHiddenScopes((previous) => new Set(previous).add(scope(userId, id)));
  return true;
}

function showLocally(userId: string, id: string): void {
  storage(id).write(userId, 'shown');
  setHiddenScopes((previous) => {
    const next = new Set(previous);
    next.delete(scope(userId, id));
    return next;
  });
}

/** Dismiss everywhere. Used by the close button and by fulfilled prompts. */
export function hidePromotion(userId: string | undefined, id: string): void {
  if (hideLocally(userId, id)) dismissPromptEverywhere(id);
}

/** A dismissal still open to Undo. */
export type PendingDismissal = {
  /** Dismiss everywhere. */
  commit(): void;
  /** Show it again; the server never hears of it. */
  undo(): void;
};

/**
 * Hide at once on this browser, and dismiss everywhere only on `commit`, or
 * when the page goes away first, since nothing could undo it then. The first
 * of `commit` and `undo` decides; later calls do nothing.
 */
export function hidePromotionUntilCommitted(
  userId: string | undefined,
  id: string
): PendingDismissal {
  if (!userId || !hideLocally(userId, id)) return { commit() {}, undo() {} };
  let settled = false;
  const settle = (then: () => void) => () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('pagehide', commit);
    then();
  };
  const commit = settle(() => dismissPromptEverywhere(id));
  window.addEventListener('pagehide', commit);
  return { commit, undo: settle(() => showLocally(userId, id)) };
}
