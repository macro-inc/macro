import { PropertyValue } from '@core/component/Properties/component/propertyValue/PropertyValue';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import { Modals } from '@core/component/Properties/component/modal';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show, createMemo } from 'solid-js';
import { useSaveEntityPropertyMutation } from '@queries/properties/entity';

const PROPERTY_SORT_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
] as const;

function sortProperties(properties: Property[]): Property[] {
  return [...properties].sort((a, b) => {
    const aIndex = PROPERTY_SORT_ORDER.indexOf(
      a.propertyDefinitionId as (typeof PROPERTY_SORT_ORDER)[number]
    );
    const bIndex = PROPERTY_SORT_ORDER.indexOf(
      b.propertyDefinitionId as (typeof PROPERTY_SORT_ORDER)[number]
    );

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) {
      return -1;
    }
    if (bIndex !== -1) {
      return 1;
    }
    return 0;
  });
}

type EntityPropertyValuesProps = {
  properties: Property[];
  entityId: string;
  entityType: EntityType;
  excludeKeyProperties?: boolean;
  maxDisplay?: number;
  onRefresh?: () => void;
};

const MAX_DEFAULT_DISPLAY = 4;

export const EntityPropertyValues = (props: EntityPropertyValuesProps) => {
  const displayProperties = createMemo(() => {
    const sorted = sortProperties(props.properties);
    return sorted.slice(0, props.maxDisplay ?? MAX_DEFAULT_DISPLAY);
  });

  const saveMutation = useSaveEntityPropertyMutation();

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property: Property, value: PropertyApiValues) =>
      saveMutation.mutateAsync({
        entityId: props.entityId,
        entityType: props.entityType,
        property,
        apiValues: value,
      }),
    saveDate: (property: Property, date: Date) =>
      saveMutation.mutateAsync({
        entityId: props.entityId,
        entityType: props.entityType,
        property,
        apiValues: {
          valueType: 'DATE',
          value: date.toISOString(),
        },
      }),
  };

  return (
    <Show when={props.properties.length > 0}>
      <PropertiesProvider
        entityType={props.entityType}
        canEdit={true}
        properties={displayProperties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <div class="flex items-center gap-1 justify-start overflow-hidden">
          <For each={displayProperties()}>
            {(property) => (
              <div class="relative">
                <PropertyValue property={property} condensed />
              </div>
            )}
          </For>
        </div>
        <Modals />
      </PropertiesProvider>
    </Show>
  );
};
