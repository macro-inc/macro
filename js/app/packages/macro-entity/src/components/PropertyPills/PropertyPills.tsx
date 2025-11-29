import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { cornerClip } from '@core/util/clipPath';
import { For, Match, Show, Switch } from 'solid-js';
import { BooleanPropertyPill } from './BooleanPropertyPill';
import { EntityPropertyPill } from './EntityPropertyPill';
import { LinkPropertyPill } from './LinkPropertyPill';
import { PropertyPillTooltip } from './PropertyPillTooltip';

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
      <div class="flex items-center gap-1 justify-end">
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
 * Pill - shows icon + text when wide, icon only when narrow
 * Uses @container/soup from Soup.tsx
 * - >= @3xl (~768px): full (icon + text)
 * - < @3xl: compact (icon only)
 */
const TextPropertyPill = (props: PropertyPillProps) => {
  const displayValue = () => formatPillValue(props.property);

  const value = displayValue();
  if (!value) return null;

  return (
    <Tooltip
      tooltip={<TextTooltipContent property={props.property} />}
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="p-px bg-edge box-border h-fit flex items-center shrink-0"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <PropertyDataTypeIcon
            property={{
              data_type: props.property.valueType,
              specific_entity_type: props.property.specificEntityType,
            }}
            class="size-3.5 shrink-0"
          />
          <span class="truncate max-w-[100px] hidden @3xl/soup:inline">
            {value}
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

/**
 * Tooltip content for a property pill
 */
const TextTooltipContent = (props: { property: Property }) => {
  const getValues = (): string[] => {
    const { property } = props;
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

  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={getValues()}>
          {(value) => (
            <div
              class="p-px bg-edge box-border h-fit w-fit flex items-center"
              style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
            >
              <div
                class="inline-flex items-center px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
                style={{
                  'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0),
                }}
              >
                <span class="truncate max-w-[150px]">{value}</span>
              </div>
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
