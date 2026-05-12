import { Modals } from '@core/component/Properties/component/modal';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import {
  Entity,
  type EntityData,
  type EntityWithProperties,
  isProjectContainedEntity,
  MultiSelectCheckbox,
  ProjectBreadCrumb,
  UnreadIndicator,
} from '@entity';
import {
  CreatedByBadgeSmall,
  SharedBadgeSmall,
} from '@entity/components/Badges';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import { soupPropertyToProperty } from '@entity/extractors-property';
import { useUserId } from '@queries/auth';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { ListPropertyValue } from './list-property-value';
import {
  TASK_GRID_COLUMNS,
  TASK_GRID_TEMPLATE_AREAS_WIDE,
  TASK_GRID_TEMPLATE_COLUMNS_WIDE,
  type TaskGridColumn,
} from './task-grid-template';

const EPOCH = new Date(0).toISOString();

/**
 * Build a placeholder Property for a column when the entity doesn't yet have
 * the property attached. Lets the editor open and create the property on save.
 */
function buildStubProperty(col: TaskGridColumn): Property {
  const stubSoup: SoupProperty = {
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

export function TaskGridLayout(props: LayoutProps) {
  const currentId = useUserId();
  const entity = () => props.entity as EntityWithProperties<EntityData>;
  const isShared = () => props.entity.ownerId !== currentId();

  // Get owner's first name for the Created By column
  const ownerNameParts = () =>
    useDisplayNameParts(tryMacroId(props.entity.ownerId));
  const ownerDisplayName = () =>
    isShared() ? ownerNameParts().firstName() || 'Unknown' : 'Me';

  const propertyMap = createMemo(() => {
    const map = new Map<string, Property>();
    for (const sp of entity().properties ?? []) {
      const property = soupPropertyToProperty(sp);
      map.set(property.propertyDefinitionId, property);
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
        style={{
          'grid-template-columns': TASK_GRID_TEMPLATE_COLUMNS_WIDE,
          'grid-template-areas': TASK_GRID_TEMPLATE_AREAS_WIDE,
        }}
      >
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

        <Entity.Slot
          placement="content"
          class="ph-no-capture font-semibold truncate items-center gap-2 flex min-w-0"
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
          {/* Show shared badges on narrow/medium containers, hide on wide (>1220px) */}
          <Show when={isShared()}>
            {/* Narrow: "shared this with you" tooltip */}
            <span class="@min-[841px]/u-list:hidden">
              <SharedBadgeSmall ownerId={props.entity.ownerId} />
            </span>
            {/* Medium (841px-1220px): "Created by" tooltip */}
            <span class="hidden @min-[841px]/u-list:inline @min-[1221px]/u-list:hidden">
              <CreatedByBadgeSmall ownerId={props.entity.ownerId} />
            </span>
          </Show>
        </Entity.Slot>

        <For each={TASK_GRID_COLUMNS}>
          {(col) => (
            <Entity.Slot
              placement={col.id}
              class="flex items-center min-w-0 overflow-hidden text-xs ph-no-capture @container/slot"
            >
              <ListPropertyValue
                property={
                  propertyMap().get(col.defId) ?? buildStubProperty(col)
                }
              />
            </Entity.Slot>
          )}
        </For>

        {/* Created By column - only shown on wide containers (>1220px) */}
        <Entity.Slot
          placement="createdBy"
          class="hidden @min-[1221px]/u-list:flex items-center gap-1.5 min-w-0 overflow-hidden text-xs ph-no-capture"
        >
          <UserIcon id={props.entity.ownerId} size="sm" showTooltip={true} />
          <span class="truncate text-ink-muted">{ownerDisplayName()}</span>
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
