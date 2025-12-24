import { useBulkEntityPropertiesQuery } from '@queries/properties/bulk';
import { createMemo } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { Property } from '../types';

export type TaskPropertiesStore = Record<string, Property[]>;

interface Entity {
  id: string;
  type: string;
  subType?: string | null;
}

const TASK_PROPERTY_DEFINITION_IDS = [
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
];

function isTaskEntity(entity: Entity): boolean {
  return entity.type === 'document' && entity.subType === 'task';
}

/**
 * Hook to fetch and cache properties for task entities.
 * Returns a store where keys are entity IDs and values are property arrays.
 *
 * Uses TanStack Query cache internally - properties are cached per entity
 * and won't be refetched if already in cache.
 *
 * @param entities - Accessor for the list of entities to fetch properties for
 */
export function useTaskProperties(
  entities: () => Entity[] | undefined
): () => TaskPropertiesStore {
  const taskEntityRefs = createMemo(() => {
    const allEntities = entities() ?? [];
    const taskEntities = allEntities.filter(isTaskEntity);
    return taskEntities.map((e) => ({
      entity_id: e.id,
      entity_type: 'TASK' as const,
    }));
  });

  const query = useBulkEntityPropertiesQuery(
    taskEntityRefs,
    TASK_PROPERTY_DEFINITION_IDS
  );

  return () => query.data;
}
