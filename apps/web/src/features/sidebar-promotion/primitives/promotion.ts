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

/** Dismiss everywhere. Used by the close button and by fulfilled prompts. */
export function hidePromotion(userId: string | undefined, id: string): void {
  if (!userId || isPromotionHiddenLocally(userId, id)) return;
  storage(id).write(userId, 'hidden');
  setHiddenScopes((previous) => new Set(previous).add(scope(userId, id)));
  dismissPromptEverywhere(id);
}
