import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { Property } from '@property';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo } from 'solid-js';
import type { TaskEntityWithProperties } from '../types/entity';
import { soupPropertyToProperty } from './property-helpers';

/** The task's leading icon is also its status editor on desktop and touch. */
export function TaskStatusControl(props: { entity: TaskEntityWithProperties }) {
  const property = createMemo(() =>
    soupPropertyToProperty(
      props.entity.properties?.find(
        (property) =>
          property.definition.id === SYSTEM_PROPERTY_IDS.STATUS &&
          property.definition.data_type === 'SELECT_STRING'
      ) ?? {
        id: `pending:${SYSTEM_PROPERTY_IDS.STATUS}`,
        definition: {
          id: SYSTEM_PROPERTY_IDS.STATUS,
          display_name: 'Status',
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
    <Property.Root
      property={property()}
      class="shrink-0"
      canEdit
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
    >
      {(shown) => {
        const statusId = () => {
          const property = shown();
          return property.valueType === 'SELECT_STRING'
            ? property.value?.[0]
            : undefined;
        };
        return (
          <>
            <Property.Tooltip property={shown()}>
              <Property.EditTrigger
                aria-label="Change status"
                data-blocks-navigation
                class="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-hover touch:size-9"
              >
                <TaskStatusIcon
                  statusId={statusId()}
                  completed={props.entity.subType.is_completed}
                  size="xs"
                />
              </Property.EditTrigger>
            </Property.Tooltip>
            <Property.PopoverEditor />
          </>
        );
      }}
    </Property.Root>
  );
}
