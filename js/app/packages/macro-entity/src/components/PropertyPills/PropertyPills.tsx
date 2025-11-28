import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { cornerClip } from '@core/util/clipPath';
import { For, Match, Show, Switch } from 'solid-js';
import { BooleanPropertyPill } from './BooleanPropertyPill';
import { EntityPropertyPill } from './EntityPropertyPill';
import { LinkPropertyPill } from './LinkPropertyPill';

type PropertyPillsProps = {
  properties: Property[];
};

/**
 * Component to display multiple property pills
 * Properties are displayed in the order provided (which should match displayProperties order)
 */
const MAX_DISPLAY_PILLS = 4;

export const PropertyPills = (props: PropertyPillsProps) => {
  const displayProperties = () => props.properties.slice(0, MAX_DISPLAY_PILLS);

  return (
    <Show when={props.properties.length > 0}>
      <div class="flex items-center gap-1 flex-wrap justify-end">
        <For each={displayProperties()}>
          {(property) => <PropertyPill property={property} />}
        </For>
      </div>
    </Show>
  );
};

type PropertyPillProps = {
  property: Property;
};

/**
 * Routes to specialized pill components based on property type
 */
const PropertyPill = (props: PropertyPillProps) => {
  return (
    <Switch fallback={<TextPropertyPill property={props.property} />}>
      <Match when={props.property.valueType === 'BOOLEAN'}>
        <BooleanPropertyPill
          property={props.property as Property & { valueType: 'BOOLEAN' }}
        />
      </Match>
      <Match when={props.property.valueType === 'ENTITY'}>
        <EntityPropertyPill
          property={props.property as Property & { valueType: 'ENTITY' }}
        />
      </Match>
      <Match when={props.property.valueType === 'LINK'}>
        <LinkPropertyPill
          property={props.property as Property & { valueType: 'LINK' }}
        />
      </Match>
    </Switch>
  );
};

/**
 * Pill for String, Number, Date, Select types
 */
const TextPropertyPill = (props: PropertyPillProps) => {
  const displayValue = () => formatPillValue(props.property);

  const value = displayValue();
  if (!value) return null;

  return (
    <div
      class="p-px bg-edge box-border h-fit flex items-center"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
      >
        <PropertyDataTypeIcon
          property={{
            data_type: props.property.valueType,
            specific_entity_type: props.property.specificEntityType,
          }}
        />
        <span class="truncate max-w-[120px]" title={value}>
          {value}
        </span>
      </div>
    </div>
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
