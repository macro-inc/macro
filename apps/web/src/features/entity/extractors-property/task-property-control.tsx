import { PropertyIconControl } from '@property/component/PropertyIconControl';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo } from 'solid-js';
import type { TaskEntityWithProperties } from '../types/entity';
import { soupPropertyToProperty } from './property-helpers';

/** Compact status and priority editors before the task title. */
export function TaskPropertyControl(props: {
  entity: TaskEntityWithProperties;
  property: 'status' | 'priority';
}) {
  const definitionId = () =>
    props.property === 'status'
      ? SYSTEM_PROPERTY_IDS.STATUS
      : SYSTEM_PROPERTY_IDS.PRIORITY;
  const property = createMemo(() =>
    soupPropertyToProperty(
      props.entity.properties?.find(
        (property) =>
          property.definition.id === definitionId() &&
          property.definition.data_type === 'SELECT_STRING'
      ) ?? {
        id: `pending:${definitionId()}`,
        definition: {
          id: definitionId(),
          display_name: props.property === 'status' ? 'Status' : 'Priority',
          data_type: 'SELECT_STRING',
          is_metadata: false,
          is_multi_select: false,
          is_system: true,
          owner: { scope: 'system' },
          specific_entity_type: null,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        },
      }
    )
  );
  const save = useBulkSaveEntityPropertiesMutation();

  return (
    <PropertyIconControl
      property={property()}
      canEdit
      completed={props.entity.subType.is_completed}
      onSave={(property, apiValues) =>
        save.mutateAsync({
          properties: [
            {
              entityId: props.entity.id,
              entityType: EntityType.TASK,
              property,
              apiValues,
            },
          ],
        })
      }
    />
  );
}
