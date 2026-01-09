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

function isTaskEntity(
  entity: Entity
): entity is Entity & { type: 'document'; subType: 'task' } {
  return entity.type === 'document' && entity.subType === 'task';
}

export function useTaskProperties(
  entities: () => Entity[] | undefined
): () => TaskPropertiesStore {
  const taskEntityRefs = createMemo(() => {
    const allEntities = entities() ?? [];
    const taskEntities = allEntities.filter(isTaskEntity);
    console.log('[useTaskProperties] allEntities:', allEntities.length, 'taskEntities:', taskEntities.length);
    return taskEntities.map((e) => ({ entity_id: e.id, entity_type: 'TASK' as const }));
  });

  const query = useBulkEntityPropertiesQuery(
    taskEntityRefs,
    TASK_PROPERTY_DEFINITION_IDS
  );

  console.log('[useTaskProperties] query status:', query.status, 'data keys:', Object.keys(query.data ?? {}));

  return () => query.data ?? {};
}
