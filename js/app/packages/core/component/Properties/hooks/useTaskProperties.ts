import type { SubType } from '@entity';
import { useBulkEntityPropertiesQuery } from '@queries/properties/bulk';
import { createMemo } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { Property } from '../types';

export type TaskPropertiesStore = Record<string, Property[]>;

interface Entity {
  id: string;
  type: string;
  subType?: SubType;
}

const TASK_PROPERTY_DEFINITION_IDS = [
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
];

function isTaskEntity(
  entity: Entity
): entity is Entity & { type: 'document'; subType: { type: 'task' } } {
  return entity.type === 'document' && entity.subType?.type === 'task';
}

export function useTaskProperties(
  entities: () => Entity[] | undefined
): () => TaskPropertiesStore {
  const taskEntityIds = createMemo(() => {
    const allEntities = entities() ?? [];
    return allEntities.filter(isTaskEntity).map((e) => e.id);
  });

  const query = useBulkEntityPropertiesQuery(
    'TASK',
    taskEntityIds,
    TASK_PROPERTY_DEFINITION_IDS
  );

  return () => {
    if (query.isLoading || !query.data) return {};
    return query.data;
  };
}
