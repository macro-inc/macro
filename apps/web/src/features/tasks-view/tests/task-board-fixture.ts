import type { TaskEntityWithProperties } from '@entity/types/entity';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';

export function boardEntity(
  id: string,
  properties: SoupProperty[] = []
): TaskEntityWithProperties {
  return {
    id,
    name: id,
    ownerId: 'viewer',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    properties,
  };
}

export function boardProperty(
  id: string,
  value: SoupProperty['value'],
  dataType: 'ENTITY' | 'SELECT_STRING' = 'ENTITY'
): SoupProperty {
  return {
    id: `assignment:${id}`,
    definition: {
      id,
      display_name: id,
      data_type: dataType,
      is_multi_select: dataType === 'ENTITY',
      specific_entity_type: null,
      is_metadata: false,
      is_system: true,
      owner: { scope: 'system' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    value,
  };
}
