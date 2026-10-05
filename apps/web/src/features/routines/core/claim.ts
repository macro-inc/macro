// Must match `MAX_ACTION_TIME` on the backend
// (services/scheduled_action/src/domain/models.rs). After this window
// a claim is treated as stale — an executor crashed mid-run — so we stop
// reporting the action as running.
const MAX_CLAIMED_MS = 20 * 60 * 1000;

export function isClaimActive(
  claimed: string | undefined | null,
  now = Date.now()
): boolean {
  if (!claimed) return false;
  return now - Date.parse(claimed) < MAX_CLAIMED_MS;
}
