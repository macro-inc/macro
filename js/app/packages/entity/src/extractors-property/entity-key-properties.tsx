import { Modals } from '@core/component/Properties/component/modal';
import { PropertyValue } from '@core/component/Properties/component/propertyValue/PropertyValue';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EntityData,
  type EntityWithProperties,
  isTaskEntity,
} from '../types/entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from './property-helpers';

function getEntityType(entity: EntityData): EntityType {
  return match(entity)
    .when(isTaskEntity, () => EntityType.TASK)
    .with({ type: 'channel' }, () => EntityType.CHANNEL)
    .with({ type: 'chat' }, () => EntityType.CHAT)
    .with({ type: 'project' }, () => EntityType.PROJECT)
    .with({ type: 'email' }, () => EntityType.THREAD)
    .with({ type: 'document' }, () => EntityType.DOCUMENT)
    .with({ type: 'channel_message' }, () => EntityType.CHANNEL)
    .with({ type: 'call' }, () => EntityType.CHANNEL)
    .with({ type: 'automation' }, () => {
      throw new Error('automation entities do not support properties');
    })
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
    return getSortedKeyProperties(soupProperties.map(soupPropertyToProperty));
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entity.id,
          entityType: entityType(),
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
        <div class="flex items-center gap-1 justify-start overflow-hidden">
          <For each={keyProperties()}>
            {(property) => (
              <div class="relative">
                <PropertyValue property={property} condensed />
              </div>
            )}
          </For>
        </div>
        <Suspense>
          <Modals />
        </Suspense>
      </PropertiesProvider>
    </Show>
  );
}
