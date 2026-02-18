import type { EntityData } from '@entity';

/** Takes a list of entity pools and returns a list of unique entities that are present in all pools, deduplicating by id */
export function intersectEntityPools(
  pools: readonly EntityData[][]
): EntityData[] {
  if (pools.length === 0) return [];
  if (pools.length === 1) return pools[0];

  const idCounts = new Map<string, number>();
  const entityById = new Map<string, EntityData>();

  for (const pool of pools) {
    const seen = new Set<string>();
    for (const entity of pool) {
      if (!seen.has(entity.id)) {
        seen.add(entity.id);
        idCounts.set(entity.id, (idCounts.get(entity.id) ?? 0) + 1);
        if (!entityById.has(entity.id)) {
          entityById.set(entity.id, entity);
        }
      }
    }
  }

  const result: EntityData[] = [];
  for (const [id, count] of idCounts) {
    if (count === pools.length) {
      result.push(entityById.get(id)!);
    }
  }

  return result;
}
