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

const notifiedFloors = createStampFloors();

/** Record a delivered notification's time as the entity's floor. */
export function raiseNotifiedFloor(entityId: string, notifiedAt: string): void {
  notifiedFloors.raise(entityId, notifiedAt);
}

/**
 * Resolve the effective notified_at for an entity: the server value unless a
 * newer floor exists. Clears the floor once the server catches up.
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
