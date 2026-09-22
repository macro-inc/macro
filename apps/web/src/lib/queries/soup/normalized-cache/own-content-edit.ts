/**
 * The viewer's own content edits, as a touch on the edited entity.
 *
 * A collab session batches the peers' edits and publishes one attributed
 * snapshot every few seconds, which the activity consumer then records. Until
 * that lands, a Home (`touched_by_me`) read still returns the entity's old
 * position, so typing stamps an optimistic touch the same way explicit
 * mutations do — see the allowlist rule in `own-touch.ts`.
 *
 * Keystrokes are far more frequent than publishes, and a stamp rewrites the
 * cached entity, so the leading edge stamps and the rest of the window is
 * dropped: the floor only has to stay ahead of the server, not track every
 * character.
 */

import { bumpSoupEntityTouchedAt } from './operations';

/** Matches the sync service's publish cadence; see its alarm debounce. */
export const OWN_CONTENT_EDIT_STAMP_INTERVAL_MS = 5_000;

const lastStampedAt = new Map<string, number>();

/**
 * Stamp the viewer's touch on an entity they just edited the content of.
 * Call it only once the edit has actually reached the collab document — the
 * publish that attributes it is what the stamp is standing in for.
 */
export function stampOwnContentEdit(entityId: string, now = Date.now()): void {
  const last = lastStampedAt.get(entityId);
  if (last !== undefined && now - last < OWN_CONTENT_EDIT_STAMP_INTERVAL_MS) {
    return;
  }
  lastStampedAt.set(entityId, now);
  bumpSoupEntityTouchedAt(entityId);
}

/** Test-only: forget the throttle window between cases. */
export function clearOwnContentEditStamps(): void {
  lastStampedAt.clear();
}
