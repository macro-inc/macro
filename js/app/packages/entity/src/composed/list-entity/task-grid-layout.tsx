import { createMemo, For, Show, Suspense } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { PropertyValue } from '@core/component/Properties/component/propertyValue/PropertyValue';
import { Modals } from '@core/component/Properties/component/modal';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { ProjectBreadCrumb } from '../../components/ProjectBreadCrumb';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import { soupPropertyToProperty } from '../../extractors-property';
import {
  isProjectContainedEntity,
  type EntityData,
  type EntityWithProperties,
} from '../../types/entity';
import type { LayoutProps } from './shared';

const TASK_GRID_COLUMNS = [
  {
    id: 'status',
    defId: SYSTEM_PROPERTY_IDS.STATUS,
    width: 'minmax(9rem, 10%)',
    condensed: false,
  },
  {
    id: 'priority',
    defId: SYSTEM_PROPERTY_IDS.PRIORITY,
    width: 'minmax(9rem, 10%)',
    condensed: false,
  },
  {
    id: 'assignees',
    defId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    width: 'minmax(3rem, 10%)',
    condensed: true,
  },
] as const;

export function TaskGridLayout(props: LayoutProps) {
  const entity = () => props.entity as EntityWithProperties<EntityData>;

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

  const propertyCols = TASK_GRID_COLUMNS.map((c) => c.width).join(' ');
  const propertyAreas = TASK_GRID_COLUMNS.map((c) => c.id).join(' ');

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
          'w-full min-h-[inherit] items-center text-sm px-2',
          'gap-2 grid grid-rows-[1fr]'
        )}
        style={{
          'grid-template-columns': `1rem minmax(0, 60%) ${propertyCols} 8ch`,
          'grid-template-areas': `"indicator content ${propertyAreas} timestamp"`,
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
              <span class="ph-no-capture text-ink-extra-muted text-xs shrink-0 truncate">
                <ProjectBreadCrumb
                  entity={entity()}
                  onClick={props.onProjectClick}
                />
              </span>
            )}
          </Show>
        </Entity.Slot>

        <For each={TASK_GRID_COLUMNS}>
          {(col) => (
            <Entity.Slot
              placement={col.id}
              class="flex items-center min-w-0 overflow-hidden text-xs ph-no-capture"
            >
              <Show when={propertyMap().get(col.defId)}>
                {(property) => (
                  <PropertyValue
                    property={property()}
                    condensed={col.condensed}
                  />
                )}
              </Show>
            </Entity.Slot>
          )}
        </For>

        <Entity.Slot
          placement="timestamp"
          class="text-xs font-mono text-right text-ink-extra-muted uppercase font-light"
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
