/**
 * Optimistic timestamp floors keyed by entity id.
 *
 * A stamp the client already knows about (its own mutation, a notification
 * that just arrived) can be overtaken by a refetch that started before the
 * server recorded it and so returns the OLD value; the normalized cache's
 * field-merge would let that stale page overwrite the fresher stamp. Instead
 * of racing the server, stamps are recorded here and reads resolve to
 * max(server, floor); an entry clears itself the moment the server value
 * catches up, so steady-state reads are pass-through.
 *
 * Import-free on purpose: floors sit below the normalized cache, the entity
 * mappers, and the list-view gates, which would otherwise form an import
 * cycle.
 */
export function createStampFloors() {
  const floors = new Map<string, string>();

  return {
    /** Record `stamp` as the entity's floor unless a newer one is held. */
    raise(entityId: string, stamp: string): void {
      const current = floors.get(entityId);
      if (
        current === undefined ||
        new Date(stamp).getTime() > new Date(current).getTime()
      ) {
        floors.set(entityId, stamp);
      }
    },

    /**
     * The server value unless a newer floor exists. Clears the floor once the
     * server catches up.
     */
    resolve(
      entityId: string,
      serverValue: string | null | undefined
    ): string | null | undefined {
      const floor = floors.get(entityId);
      if (floor === undefined) return serverValue;
      if (
        serverValue &&
        new Date(serverValue).getTime() >= new Date(floor).getTime()
      ) {
        floors.delete(entityId);
        return serverValue;
      }
      return floor;
    },

    has(entityId: string): boolean {
      return floors.has(entityId);
    },

    /** Test-only: reset all floors between cases. */
    clear(): void {
      floors.clear();
    },
  };
}
