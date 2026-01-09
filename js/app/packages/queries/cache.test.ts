import { QueryClient } from '@tanstack/solid-query';
import { describe, expect, it } from 'vitest';
import { partitionByQueryCache } from './cache';

type EntityRef = { entity_id: string; entity_type: string };

const entityQueryKey = (entity: EntityRef) =>
  ['properties', 'entity', entity.entity_type, entity.entity_id] as const;

describe('partitionByQueryCache', () => {
  it('returns all items as missing when cache is empty', () => {
    const queryClient = new QueryClient();
    const entities: EntityRef[] = [
      { entity_id: 'A', entity_type: 'TASK' },
      { entity_id: 'B', entity_type: 'TASK' },
      { entity_id: 'C', entity_type: 'TASK' },
    ];

    const { cached, missing } = partitionByQueryCache<EntityRef, string[]>({
      queryClient,
      items: entities,
      queryKeyOf: entityQueryKey,
    });

    expect(cached.size).toBe(0);
    expect(missing).toEqual(entities);
  });

  it('returns all items as cached when all are in cache', () => {
    const queryClient = new QueryClient();
    const entities: EntityRef[] = [
      { entity_id: 'A', entity_type: 'TASK' },
      { entity_id: 'B', entity_type: 'TASK' },
      { entity_id: 'C', entity_type: 'TASK' },
    ];

    for (const entity of entities) {
      queryClient.setQueryData(entityQueryKey(entity), [
        `data-${entity.entity_id}`,
      ]);
    }

    const { cached, missing } = partitionByQueryCache<EntityRef, string[]>({
      queryClient,
      items: entities,
      queryKeyOf: entityQueryKey,
    });

    expect(missing).toEqual([]);
    expect(cached.size).toBe(3);
    expect(cached.get(entities[0])).toEqual(['data-A']);
    expect(cached.get(entities[1])).toEqual(['data-B']);
    expect(cached.get(entities[2])).toEqual(['data-C']);
  });

  it('only returns uncached items as missing when some are cached', () => {
    const queryClient = new QueryClient();
    const entitiesABC: EntityRef[] = [
      { entity_id: 'A', entity_type: 'TASK' },
      { entity_id: 'B', entity_type: 'TASK' },
      { entity_id: 'C', entity_type: 'TASK' },
    ];

    // Cache A, B, C
    for (const entity of entitiesABC) {
      queryClient.setQueryData(entityQueryKey(entity), [
        `data-${entity.entity_id}`,
      ]);
    }

    // Now request A, B, C, D - only D should be missing
    const entityD: EntityRef = { entity_id: 'D', entity_type: 'TASK' };
    const entitiesABCD = [...entitiesABC, entityD];

    const { cached, missing } = partitionByQueryCache<EntityRef, string[]>({
      queryClient,
      items: entitiesABCD,
      queryKeyOf: entityQueryKey,
    });

    expect(missing).toEqual([entityD]);
    expect(cached.size).toBe(3);
    expect(cached.get(entitiesABC[0])).toEqual(['data-A']);
    expect(cached.get(entitiesABC[1])).toEqual(['data-B']);
    expect(cached.get(entitiesABC[2])).toEqual(['data-C']);
  });

  it('handles empty items array', () => {
    const queryClient = new QueryClient();

    const { cached, missing } = partitionByQueryCache<EntityRef, string[]>({
      queryClient,
      items: [],
      queryKeyOf: entityQueryKey,
    });

    expect(cached.size).toBe(0);
    expect(missing).toEqual([]);
  });
});
