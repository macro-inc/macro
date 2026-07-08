import {
  Entity,
  type EntityData,
  isCrmCompanyEntity,
  MultiSelectCheckbox,
  UnreadIndicator,
} from '@entity';
import type { LayoutProps } from '@entity/composed/list-entity/shared';
import {
  buildCompanyDefaultProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property';
import { Modals } from '@property/component/modal';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import type { Property, PropertyApiValues } from '@property/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useIsTeamAdmin } from '@queries/team/teams';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { ListPropertyValue } from '../tasks/list-property-value';
import {
  COMPANY_GRID_COLUMNS,
  COMPANY_GRID_TEMPLATE_AREAS,
  COMPANY_GRID_TEMPLATE_AREAS_NO_INDICATOR,
  COMPANY_GRID_TEMPLATE_COLUMNS,
  COMPANY_GRID_TEMPLATE_COLUMNS_NO_INDICATOR,
} from './company-grid-template';

/**
 * Grid row layout for the Customers list: company name + editable CRM
 * property columns (Stage, Owner, Revenue) and a trailing Last
 * Interaction timestamp, mirroring `TaskGridLayout`.
 */
export function CompanyGridLayout(props: LayoutProps) {
  const isTeamAdmin = useIsTeamAdmin();

  const primaryDomain = () => {
    const entity = props.entity as EntityData;
    return isCrmCompanyEntity(entity) ? entity.domains[0]?.domain : undefined;
  };

  // Fetched properties by definition id, with builtin stubs filling the
  // gaps so every column renders (and can open its editor) even before a
  // value is saved.
  const propertyMap = createMemo(() => {
    const map = new Map<string, Property>();
    const entity = props.entity as EntityData;
    if (!isCrmCompanyEntity(entity)) return map;
    for (const soupProperty of entity.properties ?? []) {
      try {
        const property = soupPropertyToProperty(soupProperty);
        map.set(property.propertyDefinitionId, property);
      } catch (error) {
        console.warn('Skipping property with unsupported type', error);
      }
    }
    for (const stub of buildCompanyDefaultProperties()) {
      if (!map.has(stub.propertyDefinitionId)) {
        map.set(stub.propertyDefinitionId, stub);
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
          entityType: EntityType.COMPANY,
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
      entityType={EntityType.COMPANY}
      canEdit={isTeamAdmin()}
      properties={properties}
      onRefresh={() => {}}
      onPropertyAdded={() => {}}
      onPropertyDeleted={() => {}}
      saveHandler={saveHandler}
    >
      <Entity.Layout
        class={cn(
          'company-grid-row w-full min-h-[inherit] items-center text-sm px-2',
          'gap-2 grid grid-rows-[1fr]'
        )}
        style={{
          'grid-template-columns': props.hideCheckbox
            ? COMPANY_GRID_TEMPLATE_COLUMNS_NO_INDICATOR
            : COMPANY_GRID_TEMPLATE_COLUMNS,
          'grid-template-areas': props.hideCheckbox
            ? COMPANY_GRID_TEMPLATE_AREAS_NO_INDICATOR
            : COMPANY_GRID_TEMPLATE_AREAS,
        }}
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
          <Show when={primaryDomain()}>
            {(domain) => (
              <span class="truncate shrink-[2] min-w-0 text-xs font-normal text-ink-extra-muted">
                {domain()}
              </span>
            )}
          </Show>
        </Entity.Slot>

        <For each={COMPANY_GRID_COLUMNS}>
          {(col) => (
            <Entity.Slot
              placement={col.id}
              class="flex items-center min-w-0 text-xs ph-no-capture @container/slot @max-[840px]/u-list:justify-center"
            >
              <Show when={propertyMap().get(col.defId)}>
                {(property) => <ListPropertyValue property={property()} />}
              </Show>
            </Entity.Slot>
          )}
        </For>

        {/* Last interaction — `updatedAt` carries crm_companies.last_interaction,
            kept fresh from synced workspace emails. */}
        <Entity.Slot
          placement="timestamp"
          class="text-xs text-right text-ink-extra-muted font-light"
        >
          <Entity.Timestamp entity={props.entity} />
        </Entity.Slot>
      </Entity.Layout>
      <Suspense>
        <Modals />
      </Suspense>
    </PropertiesProvider>
  );
}
