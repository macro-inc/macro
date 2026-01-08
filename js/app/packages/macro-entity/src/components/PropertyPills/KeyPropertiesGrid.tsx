import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import { idToDisplayName } from '@core/user';

import { createMemo, For, Match, Show, Switch } from 'solid-js';

import { PropertyPillTooltip } from './PropertyPillTooltip';

type KeyPropertiesGridProps = {
  properties: Property[];
};

const KEY_PROPERTY_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

/**
 * Grid layout for key task properties: Status, Priority, Assignees
 * Always shows 3 cells in a row, empty cells when property is not present
 */
export const KeyPropertiesGrid = (props: KeyPropertiesGridProps) => {
  const keyProperties = createMemo(() => {
    const propertyMap = new Map<string, Property>();
    for (const property of props.properties) {
      propertyMap.set(property.propertyDefinitionId, property);
    }

    return KEY_PROPERTY_ORDER.map((id) => propertyMap.get(id) || null);
  });

  return (
    <div class="grid grid-cols-[1fr_1fr_4fr] gap-1 w-fit">
      <For each={keyProperties()}>
        {(property, index) => (
          <div
            class="h-6 flex items-center"
            classList={{
              'w-6 justify-center': index() < 2, // Status and Priority get fixed width, centered
              'min-w-6 justify-start': index() === 2, // Assignees get flexible width, left aligned
            }}
          >
            <Show when={property} fallback={<div class="h-6 w-full" />}>
              {(prop) => <KeyPropertyPill property={prop()} />}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};

type KeyPropertyPillProps = {
  property: Property;
};

/**
 * Small property pill that always shows icon only (no text)
 */
const KeyPropertyPill = (props: KeyPropertyPillProps) => {
  return (
    <Switch fallback={<TextKeyPropertyPill property={props.property} />}>
      <Match when={props.property.valueType === 'BOOLEAN'}>
        <BooleanKeyPropertyPill
          property={props.property as Property & { valueType: 'BOOLEAN' }}
        />
      </Match>
      <Match
        when={
          props.property.valueType === 'ENTITY' &&
          props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
        }
      >
        <AssigneesKeyPropertyPill
          property={props.property as Property & { valueType: 'ENTITY' }}
        />
      </Match>
      <Match when={props.property.valueType === 'ENTITY'}>
        <EntityKeyPropertyPill
          property={props.property as Property & { valueType: 'ENTITY' }}
        />
      </Match>
    </Switch>
  );
};

/**
 * Boolean property pill for key properties grid - always icon only
 */
const BooleanKeyPropertyPill = (props: {
  property: Property & { valueType: 'BOOLEAN' };
}) => {
  const isTrue = () => props.property.value === true;

  if (props.property.value === null || props.property.value === undefined) {
    return null;
  }

  return (
    <Tooltip
      tooltip={<KeyPropertyTooltip property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="inline-flex items-center justify-center size-6 text-xs leading-none border rounded"
        classList={{
          'text-ink-muted border-edge-muted': !isTrue(),
          'text-accent-muted bg-accent/10 border-accent/20': isTrue(),
        }}
      >
        <PropertyDataTypeIcon
          property={{
            data_type: props.property.valueType,
            specific_entity_type: props.property.specificEntityType,
          }}
          class="size-3 shrink-0"
        />
      </div>
    </Tooltip>
  );
};

/**
 * Assignees property pill - renders as list of user icons
 */
const AssigneesKeyPropertyPill = (props: {
  property: Property & { valueType: 'ENTITY' };
}) => {
  const entities = () => props.property.value ?? [];
  const hasEntities = () => entities().length > 0;

  if (!hasEntities()) {
    return null;
  }

  return (
    <Tooltip
      tooltip={<KeyPropertyTooltip property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="flex items-center h-full shrink-0 overflow-hidden w-fit isolate justify-start pr-2">
        <For each={entities().slice(0, 3)}>
          {(entity) => (
            <div class="bg-panel size-5 rounded-full p-[2px] -mr-2">
              <UserIcon
                id={entity.entity_id}
                size="fill"
                isDeleted={false}
                suppressClick={true}
                fetchUrl={false}
                showTooltip={false}
              />
            </div>
          )}
        </For>
        <Show when={entities().length > 3}>
          <div class="z-4">
            <Tooltip
              tooltip={entities()
                .slice(3)
                .map((entity) => idToDisplayName(entity.entity_id))
                .join(', ')}
            >
              <div class="size-5 bg-menu border-2 text-[10px] -mr-2 border-panel rounded-full flex flex-col justify-center items-center">
                <span>+{entities().length - 3}</span>
              </div>
            </Tooltip>
          </div>
        </Show>
      </div>
    </Tooltip>
  );
};

/**
 * Entity property pill for key properties grid - always icon only
 */
const EntityKeyPropertyPill = (props: {
  property: Property & { valueType: 'ENTITY' };
}) => {
  const entities = () => props.property.value ?? [];
  const hasEntities = () => entities().length > 0;

  if (!hasEntities()) {
    return null;
  }

  return (
    <Tooltip
      tooltip={<KeyPropertyTooltip property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="inline-flex items-center justify-center size-6 p-1 text-xs leading-none text-ink-muted rounded">
        <PropertyDataTypeIcon
          property={{
            data_type: props.property.valueType,
            specific_entity_type: props.property.specificEntityType,
          }}
          class="size-3 shrink-0"
        />
      </div>
    </Tooltip>
  );
};

/**
 * Default text property pill for key properties grid - always icon only
 */
const TextKeyPropertyPill = (props: KeyPropertyPillProps) => {
  const displayValue = () => formatPillValue(props.property);

  const value = displayValue();
  if (!value) return null;

  return (
    <Tooltip
      tooltip={<KeyPropertyTooltip property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div class="inline-flex items-center justify-center size-6 p-1 text-xs leading-none text-ink-muted rounded">
        <PillIcon property={props.property} />
      </div>
    </Tooltip>
  );
};

/**
 * Tooltip content for key property pills
 */
const KeyPropertyTooltip = (props: { property: Property }) => {
  // Special handling for assignees (ENTITY type with ASSIGNEES property)
  const isAssignees = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES;

  // Check if this is a multi-value property
  const isMultiValue = () => {
    if (
      props.property.valueType === 'ENTITY' &&
      Array.isArray(props.property.value)
    ) {
      return props.property.value.length > 1;
    }
    if (
      (props.property.valueType === 'SELECT_STRING' ||
        props.property.valueType === 'SELECT_NUMBER') &&
      Array.isArray(props.property.value)
    ) {
      return props.property.value.length > 1;
    }
    return false;
  };

  return (
    <PropertyPillTooltip property={props.property}>
      <Show
        when={isAssignees()}
        fallback={
          <Show
            when={isMultiValue()}
            fallback={
              // Single line for non-multiselect
              <div class="flex items-center gap-1.5">
                <For each={getValues(props.property).slice(0, 1)}>
                  {(value, index) => (
                    <>
                      <TooltipValueIcon
                        property={props.property}
                        valueIndex={index()}
                      />
                      <span class="truncate max-w-[150px]">{value}</span>
                    </>
                  )}
                </For>
              </div>
            }
          >
            {/* Multi-value wrapped layout */}
            <div class="flex items-center gap-1.5 flex-wrap">
              <For each={getValues(props.property)}>
                {(value, index) => (
                  <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted rounded box-border h-fit w-fit">
                    <TooltipValueIcon
                      property={props.property}
                      valueIndex={index()}
                    />
                    <span class="truncate max-w-[150px]">{value}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        }
      >
        {/* Special assignees layout with user icons */}
        <div class="flex flex-col gap-2">
          <For each={(props.property.value as any[]) || []}>
            {(entity) => (
              <div class="flex items-center gap-2">
                <UserIcon
                  id={entity.entity_id}
                  size="xs"
                  isDeleted={false}
                  showTooltip={false}
                />
                <span class="text-xs">{idToDisplayName(entity.entity_id)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </PropertyPillTooltip>
  );
};

// Utility functions - copied from PropertyPills.tsx for consistency

const getValues = (property: Property): string[] => {
  if (property.value === null || property.value === undefined) return [];

  if (
    (property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER') &&
    Array.isArray(property.value)
  ) {
    return property.value.map((v) => formatPropertyValue(property, v));
  }

  if (property.valueType === 'DATE' && property.value instanceof Date) {
    return [formatPropertyValue(property, property.value)];
  }

  if (property.valueType === 'NUMBER' && typeof property.value === 'number') {
    return [formatPropertyValue(property, property.value)];
  }

  if (property.valueType === 'STRING' && typeof property.value === 'string') {
    return property.value ? [property.value] : [];
  }

  if (property.valueType === 'ENTITY' && Array.isArray(property.value)) {
    return property.value.map((entity) => entity.entity_id || 'Unknown');
  }

  return [];
};

const formatPillValue = (property: Property): string | null => {
  if (property.value === null || property.value === undefined) {
    return null;
  }

  if (
    (property.valueType === 'DATE' && property.value instanceof Date) ||
    (property.valueType === 'NUMBER' && typeof property.value === 'number')
  ) {
    return formatPropertyValue(property, property.value);
  }

  if (property.valueType === 'STRING' && typeof property.value === 'string') {
    return property.value || null;
  }

  if (
    (property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER') &&
    Array.isArray(property.value)
  ) {
    if (property.value.length === 0) {
      return null;
    }
    if (property.isMultiSelect && property.value.length > 1) {
      return `${property.displayName} (${property.value.length})`;
    }
    return formatPropertyValue(property, property.value[0]);
  }

  return null;
};

const PillIcon = (props: { property: Property }) => {
  if (
    (props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER') &&
    props.property.value &&
    props.property.value.length === 1
  ) {
    const optionId = props.property.value[0];
    return <PropertyValueIcon optionId={optionId} class="size-4 shrink-0" />;
  }

  return (
    <PropertyDataTypeIcon
      property={{
        data_type: props.property.valueType,
        specific_entity_type: props.property.specificEntityType,
      }}
      class="size-4 shrink-0"
    />
  );
};

const TooltipValueIcon = (props: {
  property: Property;
  valueIndex: number;
}) => {
  if (
    (props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER') &&
    props.property.value &&
    props.property.value[props.valueIndex]
  ) {
    const optionId = props.property.value[props.valueIndex];
    return <PropertyValueIcon optionId={optionId} class="size-3 shrink-0" />;
  }
  return null;
};
