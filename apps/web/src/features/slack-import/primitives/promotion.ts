import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';

// Keep mounted sidebars in sync, including when local storage is unavailable.
const [hiddenScopes, setHiddenScopes] = createSignal<ReadonlySet<string>>(
  new Set()
);

function storage(teamId: string) {
  return createUserScopedStorage(
    `slack-import-promotion:v1:${encodeURIComponent(teamId)}`
  );
}

export function isSlackImportPromotionHidden(
  userId: string | undefined,
  teamId: string | undefined
): boolean {
  if (!userId || !teamId) return false;
  return (
    hiddenScopes().has(JSON.stringify([userId, teamId])) ||
    storage(teamId).read(userId) === 'hidden'
  );
}

/** Used by both explicit dismissal and confirmed import completion. */
export function hideSlackImportPromotion(
  userId: string | undefined,
  teamId: string | undefined
): void {
  if (!userId || !teamId || isSlackImportPromotionHidden(userId, teamId))
    return;
  storage(teamId).write(userId, 'hidden');
  setHiddenScopes((previous) =>
    new Set(previous).add(JSON.stringify([userId, teamId]))
  );
}
