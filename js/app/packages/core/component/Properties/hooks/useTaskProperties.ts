import { createEffect } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import { fetchBulkEntityProperties } from '../api/fetchProperties';
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
): [TaskPropertiesStore, SetStoreFunction<TaskPropertiesStore>] {
  const [store, setStore] = createStore<TaskPropertiesStore>({});

  createEffect(() => {
    const allEntities = entities();
    if (!allEntities?.length) return;

    const taskEntities = allEntities.filter(isTaskEntity);
    if (taskEntities.length === 0) return;

    const entityRefs = taskEntities.map((e) => ({
      entity_id: e.id,
      entity_type: 'TASK' as const,
    }));

    fetchBulkEntityProperties(entityRefs, TASK_PROPERTY_DEFINITION_IDS).then(
      (result) => {
        for (const [id, props] of result) {
          if (!(id in store)) {
            setStore(id, props);
          }
        }
      }
    );
  });

  return [store, setStore];
}
