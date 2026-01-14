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
import { Show } from 'solid-js';
import { useSaveEntityPropertyMutation } from '@queries/properties/entity';

type EntityPropertyValuesProps = {
  properties: Property[];
  entityId: string;
  entityType: EntityType;
  excludeKeyProperties?: boolean;
  maxDisplay?: number;
  onRefresh?: () => void;
};

export const KeyPropertiesGrid = (props: EntityPropertyValuesProps) => {
  const status = () =>
    props.properties.find(
      (prop) => prop.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
    );
  const priority = () =>
    props.properties.find(
      (prop) => prop.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY
    );
  const assignees = () =>
    props.properties.find(
      (prop) => prop.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
    );

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
        properties={() => props.properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <div class="grid grid-cols-[auto_auto_2.4rem] gap-1 items-center">
          <Show when={status()}>
            {(property) => (
              <div class="relative">
                <PropertyValue property={property()} condensed />
              </div>
            )}
          </Show>
          <Show when={priority()}>
            {(property) => (
              <div class="relative">
                <PropertyValue property={property()} condensed />
              </div>
            )}
          </Show>
          <Show when={assignees()}>
            {(property) => (
              <div class="relative overflow-hidden">
                <PropertyValue property={property()} condensed />
              </div>
            )}
          </Show>
        </div>
        <Modals />
      </PropertiesProvider>
    </Show>
  );
};
