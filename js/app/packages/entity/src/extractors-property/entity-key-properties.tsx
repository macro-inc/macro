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
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show, createMemo } from 'solid-js';
import { useSaveEntityPropertyMutation } from '@queries/properties/entity';
import { match } from 'ts-pattern';
import {
  type EntityData,
  type EntityWithProperties,
  isTaskEntity,
} from '../types/entity';
import { soupPropertyToProperty } from './property-helpers';

/**
 * Key property definition IDs in display order: Status, Priority, Assignees
 */
const KEY_PROPERTY_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
] as const;

function getEntityType(entity: EntityData): EntityType {
  return match(entity)
    .when(isTaskEntity, () => EntityType.TASK)
    .with({ type: 'channel' }, () => EntityType.CHANNEL)
    .with({ type: 'chat' }, () => EntityType.CHAT)
    .with({ type: 'project' }, () => EntityType.PROJECT)
    .with({ type: 'email' }, () => EntityType.THREAD)
    .with({ type: 'document' }, () => EntityType.DOCUMENT)
    .exhaustive();
}

export interface EntityKeyPropertiesProps {
  /** Entity with properties attached */
  entity: EntityWithProperties<EntityData>;
  /** Callback when properties are refreshed */
  onRefresh?: () => void;
}

/**
 * Displays key properties (Status, Priority, Assignees) for an entity.
 *
 * This is an opinionated, high-level component that:
 * - Takes only an entity as input
 * - Automatically extracts properties from the entity
 * - Filters to only show Status, Priority, and Assignees
 * - Renders them in a consistent order
 * - Handles save mutations internally
 *
 * @example
 * ```tsx
 * <EntityKeyProperties entity={taskEntity} />
 * ```
 */
export function EntityKeyProperties(props: EntityKeyPropertiesProps) {
  const entityType = createMemo(() => getEntityType(props.entity));

  const keyProperties = createMemo((): Property[] => {
    const soupProperties = props.entity.properties ?? [];

    const converted = soupProperties
      .map(soupPropertyToProperty)
      .filter((prop) =>
        KEY_PROPERTY_ORDER.includes(
          prop.propertyDefinitionId as (typeof KEY_PROPERTY_ORDER)[number]
        )
      );

    return converted.sort((a, b) => {
      const aIndex = KEY_PROPERTY_ORDER.indexOf(
        a.propertyDefinitionId as (typeof KEY_PROPERTY_ORDER)[number]
      );
      const bIndex = KEY_PROPERTY_ORDER.indexOf(
        b.propertyDefinitionId as (typeof KEY_PROPERTY_ORDER)[number]
      );
      return aIndex - bIndex;
    });
  });

  const saveMutation = useSaveEntityPropertyMutation();

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property: Property, value: PropertyApiValues) =>
      saveMutation.mutateAsync({
        entityId: props.entity.id,
        entityType: entityType(),
        property,
        apiValues: value,
      }),
    saveDate: (property: Property, date: Date) =>
      saveMutation.mutateAsync({
        entityId: props.entity.id,
        entityType: entityType(),
        property,
        apiValues: {
          valueType: 'DATE',
          value: date,
        },
      }),
  };

  return (
    <Show when={keyProperties().length > 0}>
      <PropertiesProvider
        entityType={entityType()}
        canEdit={true}
        properties={keyProperties}
        onRefresh={props.onRefresh ?? (() => {})}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <div
          class="grid items-center gap-1 justify-start overflow-hidden w-24"
          style={{
            'grid-template-columns': 'min-content min-content 1fr',
          }}
        >
          <For each={keyProperties()}>
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
}
