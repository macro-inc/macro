import {
  Entity,
  isProjectContainedEntity,
  MultiSelectCheckbox,
  OwnerLabel,
  ProjectBreadCrumb,
  type TaskEntityWithProperties,
  UnreadIndicator,
} from '@entity';
import {
  CreatedByBadgeSmall,
  SharedBadgeSmall,
} from '@entity/components/Badges';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import { soupPropertyToProperty } from '@entity/extractors-property';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { Modals } from '@property/component/modal';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { EntityRowTags } from '@property/tags';
import type { Property, PropertyApiValues } from '@property/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show, Suspense } from 'solid-js';
import {
  TASK_GRID_COLUMNS,
  TASK_PROJECT_COLUMN,
  type TaskGridColumn,
  taskGridTemplate,
} from './task-grid-template';

const EPOCH = new Date(0).toISOString();

/**
 * Build a placeholder Property for a column when the entity doesn't yet have
 * the property attached. Lets the editor open and create the property on save.
 */
function buildStubProperty(col: TaskGridColumn): Property {
  const stubSoup: SoupProperty = {
    id: `pending:${col.defId}`,
    definition: {
      id: col.defId,
      display_name: col.label,
      data_type: col.dataType,
      is_metadata: false,
      is_multi_select: col.isMultiSelect,
      is_system: true,
      owner: { scope: 'system' },
      specific_entity_type: col.specificEntityType,
      created_at: EPOCH,
      updated_at: EPOCH,
    },
  };
  return soupPropertyToProperty(stubSoup);
}

type TaskGridLayoutProps = Omit<LayoutProps, 'entity'> & {
  entity: TaskEntityWithProperties;
  /** Show the Project column (Projects enabled). */
  showProject?: boolean;
};

export function TaskGridLayout(props: TaskGridLayoutProps) {
  const entity = () => props.entity;

  const propertyMap = createMemo(() => {
    const map = new Map<string, Property>();
    for (const sp of entity().properties ?? []) {
      try {
        const property = soupPropertyToProperty(sp);
        map.set(property.propertyDefinitionId, property);
      } catch (error) {
        console.warn('Skipping property with unsupported type', error);
      }
    }
    return map;
  });

  const properties = createMemo(() => Array.from(propertyMap().values()));

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entity.id,
          entityType: EntityType.TASK,
          property,
          apiValues,
        },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <PropertiesProvider
      entityId={props.entity.id}
      entityType={EntityType.TASK}
      canEdit={true}
      properties={properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={saveHandler}
    >
      <Entity.Layout
        class={cn(
          'task-grid-row w-full min-h-[inherit] items-center text-sm px-2',
          'gap-2 grid grid-rows-[1fr]'
        )}
        style={taskGridTemplate({
          indicator: !props.hideCheckbox,
          project: props.showProject === true,
        })}
      >
        <Show when={!props.hideCheckbox}>
          <Entity.Slot placement="indicator" class="relative size-full group">
            <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
              <UnreadIndicator active={props.unread} />
            </div>
            <div
              class={cn(
                'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
                {
                  'opacity-100': props.checked,
                }
              )}
            >
              <MultiSelectCheckbox
                checked={props.checked}
                onChecked={props.onChecked}
              />
            </div>
          </Entity.Slot>
        </Show>

        <Entity.Slot
          placement="content"
          class="ph-no-capture font-medium truncate items-center gap-2 flex min-w-0"
        >
          <div class="size-4 shrink-0">
            <Entity.Icon
              entity={props.entity}
              streamState={props.streamState}
            />
          </div>
          <span class="truncate min-w-0">
            <Entity.Title entity={props.entity} />
          </span>
          <Show when={isProjectContainedEntity(props.entity) && props.entity}>
            {(entity) => (
              <span class="ph-no-capture text-ink text-xs shrink-0 truncate border border-edge-muted px-2 rounded-sm py-0.5">
                <ProjectBreadCrumb
                  entity={entity()}
                  onClick={props.onProjectClick}
                />
              </span>
            )}
          </Show>
          <Show when={props.isShared}>
            <span class="@min-[841px]/u-list:hidden">
              <SharedBadgeSmall ownerId={props.entity.ownerId} />
            </span>
            <span class="hidden @min-[841px]/u-list:inline @min-[1221px]/u-list:hidden">
              <CreatedByBadgeSmall ownerId={props.entity.ownerId} />
            </span>
          </Show>
          <EntityRowTags
            entityId={props.entity.id}
            entityType={EntityType.TASK}
            properties={entity().properties}
            class="ml-auto"
          />
        </Entity.Slot>

        <For each={TASK_GRID_COLUMNS}>
          {(col) => (
            <Entity.Slot
              placement={col.id}
              class="flex items-center min-w-0 text-xs ph-no-capture @container/slot @max-[840px]/u-list:justify-center"
            >
              <ListPropertyValue
                entityId={props.entity.id}
                property={
                  propertyMap().get(col.defId) ?? buildStubProperty(col)
                }
              />
            </Entity.Slot>
          )}
        </For>

        <Show when={props.showProject}>
          <Entity.Slot
            placement={TASK_PROJECT_COLUMN.id}
            class="flex items-center min-w-0 text-xs ph-no-capture @container/slot @max-[840px]/u-list:justify-center"
          >
            <ListPropertyValue
              entityId={props.entity.id}
              property={
                propertyMap().get(TASK_PROJECT_COLUMN.defId) ??
                buildStubProperty(TASK_PROJECT_COLUMN)
              }
            />
          </Entity.Slot>
        </Show>

        <Entity.Slot
          placement="createdBy"
          class="hidden @min-[1221px]/u-list:flex items-center min-w-0 overflow-hidden text-xs text-ink-muted ph-no-capture"
        >
          <OwnerLabel ownerId={props.entity.ownerId} viewerLabel="Me" />
        </Entity.Slot>

        <Entity.Slot
          placement="timestamp"
          class="text-xs text-right text-ink-extra-muted font-light"
        >
          <Show when={!props.hasNotifications}>
            <Entity.Timestamp entity={props.entity} />
          </Show>
        </Entity.Slot>
      </Entity.Layout>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
