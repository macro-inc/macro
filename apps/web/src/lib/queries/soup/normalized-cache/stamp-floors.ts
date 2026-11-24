import { ReactiveMap } from '@solid-primitives/map';
import { batch } from 'solid-js';

type StampFloor = { stamp: string; expiresAt?: number };

/**
 * Optimistic timestamp floors keyed by entity id.
 *
 * A stamp the client already knows about (its own mutation, a notification
 * that just arrived) can be overtaken by a refetch that started before the
 * server recorded it and so returns the OLD value; the normalized cache's
 * field-merge would let that stale page overwrite the fresher stamp. Instead
 * of racing the server, stamps are recorded here and reads resolve to
 * max(server, floor). By default an entry clears when the value catches up.
 * Consumers that also map optimistic snapshots can retain floors briefly:
 * seeing the local stamp is not proof that an older refetch cannot arrive.
 *
 * Reactive floors are tracked per entity: a mapper that resolves an entity's
 * stamp inside a computation runs again when that entity's floor rises, so a
 * row that is already mapped moves without waiting for a refetch.
 *
 * Free of app imports on purpose: floors sit below the normalized cache, the
 * entity mappers, and the list-view gates, which would otherwise form an
 * import cycle.
 */
export function createStampFloors(
  options: { retainForMs?: number; reactive?: boolean } = {}
) {
  const maxRetainedFloors = 200;
  const floors: Map<string, StampFloor> = options.reactive
    ? new ReactiveMap<string, StampFloor>()
    : new Map<string, StampFloor>();
  const { retainForMs } = options;

  function getFloor(entityId: string) {
    const floor = floors.get(entityId);
    if (floor?.expiresAt !== undefined && floor.expiresAt <= Date.now()) {
      floors.delete(entityId);
      return undefined;
    }
    return floor;
  }

  return {
    /** Record `stamp` as the entity's floor unless a newer one is held. */
    raise(entityId: string, stamp: string): void {
      const current = getFloor(entityId);
      if (
        current === undefined ||
        new Date(stamp).getTime() > new Date(current.stamp).getTime()
      ) {
        // One batch, so a reactive reader never sees the floor missing.
        batch(() => {
          floors.delete(entityId);
          floors.set(entityId, {
            stamp,
            expiresAt:
              retainForMs === undefined ? undefined : Date.now() + retainForMs,
          });
          // Retained floors do not clear on reads, so cap their session state.
          if (retainForMs !== undefined && floors.size > maxRetainedFloors) {
            const oldest = floors.keys().next().value;
            if (oldest !== undefined) floors.delete(oldest);
          }
        });
      }
    },

    /**
     * The snapshot value unless a newer floor exists. Retained floors expire
     * by age, not by reading an optimistic snapshot equal to the floor.
     */
    resolve(
      entityId: string,
      serverValue: string | null | undefined
    ): string | null | undefined {
      const floor = getFloor(entityId);
      if (floor === undefined) return serverValue;
      if (
        serverValue &&
        new Date(serverValue).getTime() >= new Date(floor.stamp).getTime()
      ) {
        if (retainForMs === undefined) floors.delete(entityId);
        return serverValue;
      }
      return floor.stamp;
    },

    has(entityId: string): boolean {
      return getFloor(entityId) !== undefined;
    },

    /** Test-only: reset all floors between cases. */
    clear(): void {
      floors.clear();
    },
  };
}
