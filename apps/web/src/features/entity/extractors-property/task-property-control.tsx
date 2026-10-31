import { t } from '@app/lib/i18n';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { Property } from '@property';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertyEmptyIcon } from '@property/extractors/PropertyEmpty';
import { hasValue } from '@property/utils';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, Show } from 'solid-js';
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
              <Property.Pill
                aria-label={
                  props.property === 'status'
                    ? t('common.changeStatus')
                    : t('common.changePriority')
                }
                data-blocks-navigation
                class="flex size-6 shrink-0 items-center justify-center rounded-full border-0 touch:size-9"
              >
                <Show
                  when={props.property === 'status'}
                  fallback={
                    <Show
                      when={hasValue(shown())}
                      fallback={
                        <PropertyEmptyIcon
                          propertyDefinitionId={definitionId()}
                          class="size-4 text-ink-extra-muted mobile:size-5"
                        />
                      }
                    >
                      <Property.Icon
                        property={shown()}
                        class={
                          statusId() === PROPERTY_OPTION_IDS.PRIORITY.URGENT
                            ? 'min-h-4 min-w-4'
                            : 'min-h-4 min-w-4 mobile:min-h-5 mobile:min-w-5'
                        }
                      />
                    </Show>
                  }
                >
                  <TaskStatusIcon
                    statusId={statusId()}
                    completed={props.entity.subType.is_completed}
                    size="xs"
                    class="size-4.5"
                  />
                </Show>
              </Property.Pill>
            </Property.Tooltip>
            <Property.PopoverEditor />
          </>
        );
      }}
    </Property.Root>
  );
}
