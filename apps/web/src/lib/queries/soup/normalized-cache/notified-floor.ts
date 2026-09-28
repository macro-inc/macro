/**
 * Optimistic latest-notification stamps ("floors"), keyed by entity id.
 *
 * `notified_at` is when the viewer was last notified about an entity. A
 * notification arriving over the websocket stamps its entity right away so
 * the inbox re-sorts; a `notified_at` page that was already in flight when
 * it arrived returns the OLD stamp — see `stamp-floors.ts` for how the floor
 * guards against it.
 */

import { createStampFloors } from './stamp-floors';

// Entity mappers read both network and optimistic snapshots. Reading our own
// stamp must not retire the guard before a replica-stale refetch completes.
const NOTIFIED_FLOOR_RETENTION_MS = 5 * 60 * 1000;
const notifiedFloors = createStampFloors({
  retainForMs: NOTIFIED_FLOOR_RETENTION_MS,
});

/** Record a delivered notification's time as the entity's floor. */
export function raiseNotifiedFloor(entityId: string, notifiedAt: string): void {
  notifiedFloors.raise(entityId, notifiedAt);
}

/**
 * Resolve the effective notified_at for an entity: the snapshot value unless
 * a newer delivered stamp exists. Retained briefly across optimistic reads
 * and overlapping refetches; bounded by age and entity count.
 */
export function resolveNotifiedAt(
  entityId: string,
  serverNotifiedAt: string | null | undefined
): string | null | undefined {
  return notifiedFloors.resolve(entityId, serverNotifiedAt);
}

/** Test-only: reset all floors between cases. */
export function clearNotifiedFloors(): void {
  notifiedFloors.clear();
}
