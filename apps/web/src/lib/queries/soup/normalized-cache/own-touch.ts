/**
 * The viewer's optimistic own-touch stamps ("floors"), keyed by entity id.
 *
 * `touched_at` is the viewer's latest own mutation as recorded by the
 * activity log, which lands through an async consumer. A touched-mode
 * refetch triggered right after a mutation can therefore return the OLD
 * server value, and the normalized cache's field-merge would let it
 * overwrite a fresher optimistic stamp. Instead of racing the consumer,
 * stamps are recorded here and reads resolve to max(server, floor); an
 * entry clears itself the moment the server value catches up.
 *
 * Only mutations whose server side records an activity (the domain
 * `ActivitySource` impls: create, rename, file-type change, project move,
 * property change, channel message send) may stamp — bumping an
 * unattributed action would reorder the Recent feed only to snap back once
 * the server truth arrives. Doc content edits are NOT attributed yet
 * (`SyncContentUpdated` carries no actor), so typing must not stamp.
 *
 * This module is import-free on purpose: it sits below the normalized
 * cache, the entity mappers, and the list-view gates, which would
 * otherwise form an import cycle.
 */

const ownTouchFloors = new Map<string, string>();

/**
 * Record and return a fresh own-touch stamp for the entity. Every optimistic
 * `touched_at` write must obtain its value here so the floor is registered.
 */
export function ownTouchStamp(entityId: string): string {
  const stamp = new Date().toISOString();
  ownTouchFloors.set(entityId, stamp);
  return stamp;
}

/**
 * Resolve the effective touched_at for an entity: the server value unless a
 * newer optimistic floor exists. Clears the floor once the server catches
 * up, so steady-state reads are pass-through.
 */
export function resolveOwnTouch(
  entityId: string,
  serverTouchedAt: string | null | undefined
): string | null | undefined {
  const floor = ownTouchFloors.get(entityId);
  if (floor === undefined) return serverTouchedAt;
  if (
    serverTouchedAt &&
    new Date(serverTouchedAt).getTime() >= new Date(floor).getTime()
  ) {
    ownTouchFloors.delete(entityId);
    return serverTouchedAt;
  }
  return floor;
}

/** Whether the viewer has an outstanding optimistic touch for the entity. */
export function hasOwnTouchFloor(entityId: string): boolean {
  return ownTouchFloors.has(entityId);
}

/** Test-only: reset all floors between cases. */
export function clearOwnTouchFloors(): void {
  ownTouchFloors.clear();
}
