import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';

import { For, Match, Show, Switch } from 'solid-js';
import { BooleanPropertyPill } from './BooleanPropertyPill';
import { EntityPropertyPill } from './EntityPropertyPill';
import { LinkPropertyPill } from './LinkPropertyPill';
import { PropertyPillTooltip } from './PropertyPillTooltip';

type PropertyPillsProps = {
  properties: Property[];
  /** For tasks, exclude key properties (status, priority, assignees) that are shown in KeyPropertiesGrid */
  excludeKeyProperties?: boolean;
  /** Force compressed styling regardless of container query */
  compressed?: boolean;
};

/**
 * Component to display multiple property pills
 * Properties are displayed in the order provided (which should match displayProperties order)
 */
const MAX_DISPLAY_PILLS = 4;

const TASK_KEY_PROPERTY_IDS = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
] as const;

export const PropertyPills = (props: PropertyPillsProps) => {
  const filteredProperties = () => {
    if (props.excludeKeyProperties) {
      return props.properties.filter(
        (property) =>
          !TASK_KEY_PROPERTY_IDS.includes(property.propertyDefinitionId as any)
      );
    }
    return props.properties;
  };

  const displayProperties = () =>
    filteredProperties().slice(0, MAX_DISPLAY_PILLS);

  return (
    <Show when={filteredProperties().length > 0}>
      <div class="flex items-center gap-1 justify-end">
        <For each={displayProperties()}>
          {(property) => (
            <PropertyPill property={property} compressed={props.compressed} />
          )}
        </For>
      </div>
    </Show>
  );
};

type PropertyPillProps = {
  property: Property;
  compressed?: boolean;
};

/**
 * Routes to specialized pill components based on property type
 */
const PropertyPill = (props: PropertyPillProps) => {
  return (
    <Switch
      fallback={
        <TextPropertyPill
          property={props.property}
          compressed={props.compressed}
        />
      }
    >
      <Match when={props.property.valueType === 'BOOLEAN'}>
        <BooleanPropertyPill
          property={props.property as Property & { valueType: 'BOOLEAN' }}
          compressed={props.compressed}
        />
      </Match>
      <Match when={props.property.valueType === 'ENTITY'}>
        <EntityPropertyPill
          property={props.property as Property & { valueType: 'ENTITY' }}
          compressed={props.compressed}
        />
      </Match>
      <Match when={props.property.valueType === 'LINK'}>
        <LinkPropertyPill
          property={props.property as Property & { valueType: 'LINK' }}
          compressed={props.compressed}
        />
      </Match>
    </Switch>
  );
};

/**
 * Pill - shows icon + text when wide, icon only when narrow
 * Uses @container/soup from Soup.tsx and compressed prop
 * - >= @3xl (~768px) AND not compressed: full (icon + text)
 * - < @3xl OR compressed: compact (icon only)
 * - Status and Priority properties always show as compact (icon only)
 */
const TextPropertyPill = (props: PropertyPillProps) => {
  const displayValue = () => formatPillValue(props.property);

  const value = displayValue();
  if (!value) return null;

  return (
    <Tooltip
      unstyled
      tooltip={<TextTooltipContent property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="inline-flex items-center gap-1.5 text-xs leading-none text-ink-muted border border-edge-muted/50 h-fit shrink-0 p-1.5"
        classList={{
          '@3xl/soup:px-2 @3xl/soup:py-1': !props.compressed,
        }}
      >
        <PillIcon property={props.property} />
        <span
          class="truncate max-w-[100px] hidden"
          classList={{
            '@3xl/soup:inline': !props.compressed,
          }}
        >
          {value}
        </span>
      </div>
    </Tooltip>
  );
};

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

  return [];
};

const TextTooltipContent = (props: { property: Property }) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={getValues(props.property)}>
          {(value, index) => (
            <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted/50 h-fit w-fit">
              <TooltipValueIcon
                property={props.property}
                valueIndex={index()}
              />
              <span class="truncate max-w-[150px]">{value}</span>
            </div>
          )}
        </For>
      </div>
    </PropertyPillTooltip>
  );
};

/**
 * Format property value for display in pill (default types only)
 */
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

  // Handle SELECT_STRING and SELECT_NUMBER
  if (
    (property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER') &&
    Array.isArray(property.value)
  ) {
    if (property.value.length === 0) {
      return null;
    }
    // Multi-select with multiple values: show "Property Name (N)"
    if (property.isMultiSelect && property.value.length > 1) {
      return `${property.displayName} (${property.value.length})`;
    }
    // Single value (or multi-select with 1 value): show the value
    return formatPropertyValue(property, property.value[0]);
  }

  return null;
};

/**
 * Icon component for property pills - uses special icons for select values when available
 */
const PillIcon = (props: { property: Property }) => {
  // For SELECT_STRING and SELECT_NUMBER with single value, try to use special icon
  if (
    (props.property.valueType === 'SELECT_STRING' ||
      props.property.valueType === 'SELECT_NUMBER') &&
    props.property.value &&
    props.property.value.length === 1
  ) {
    const optionId = props.property.value[0];
    return <PropertyValueIcon optionId={optionId} class="size-3.5 shrink-0" />;
  }

  // Default to data type icon
  return (
    <PropertyDataTypeIcon
      property={{
        data_type: props.property.valueType,
        specific_entity_type: props.property.specificEntityType,
      }}
      class="size-3.5 shrink-0"
    />
  );
};

/**
 * Icon component for tooltip values - uses special icons for select values when available
 */
const TooltipValueIcon = (props: {
  property: Property;
  valueIndex: number;
}) => {
  // For SELECT_STRING and SELECT_NUMBER, try to use special icon for the specific value
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
