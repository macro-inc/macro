import {
  NUMBER_DECIMAL_PLACES,
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type {
  Property,
  PropertyOption,
  ValueType,
} from '@core/component/Properties/types';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { nanoid } from 'nanoid';
import { TASK_STATUS_OPTIONS } from '../utils/task-properties';

const EPOCH_ZERO = new Date(0);

/**
 * Sort order for key properties (status, priority, assignees)
 */
const PROPERTY_SORT_ORDER = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
] as const;

/**
 * Static options for system properties (Status and Priority).
 * These match the backend seed data and allow tooltips to display
 * human-readable values without fetching options from the API.
 */
const SYSTEM_PROPERTY_OPTIONS: Record<string, PropertyOption[]> = {
  [SYSTEM_PROPERTY_IDS.STATUS]: TASK_STATUS_OPTIONS.map(
    ({ value, label }, displayOrder) => ({
      id: value,
      property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
      value: { type: 'string', value: label },
      display_order: displayOrder,
      // TODO: need to properly handle dates. does not seem like these are even used/upserted anywhere?
      created_at: EPOCH_ZERO.toISOString(),
      updated_at: EPOCH_ZERO.toISOString(),
    })
  ),
  [SYSTEM_PROPERTY_IDS.PRIORITY]: [
    {
      id: PROPERTY_OPTION_IDS.PRIORITY.LOW,
      property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: { type: 'string', value: 'Low' },
      display_order: 0,
      created_at: EPOCH_ZERO.toISOString(),
      updated_at: EPOCH_ZERO.toISOString(),
    },
    {
      id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
      property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: { type: 'string', value: 'Medium' },
      display_order: 1,
      created_at: EPOCH_ZERO.toISOString(),
      updated_at: EPOCH_ZERO.toISOString(),
    },
    {
      id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
      property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: { type: 'string', value: 'High' },
      display_order: 2,
      created_at: EPOCH_ZERO.toISOString(),
      updated_at: EPOCH_ZERO.toISOString(),
    },
    {
      id: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
      property_definition_id: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: { type: 'string', value: 'Urgent' },
      display_order: 3,
      created_at: EPOCH_ZERO.toISOString(),
      updated_at: EPOCH_ZERO.toISOString(),
    },
  ],
};

/**
 * Get static options for a system property definition ID.
 * Returns undefined if not a known system property with static options.
 */
function getSystemPropertyOptions(
  propertyDefinitionId: string
): PropertyOption[] | undefined {
  return SYSTEM_PROPERTY_OPTIONS[propertyDefinitionId];
}

/**
 * Type guard to check if PropertyValue has a specific type
 */
function hasPropertyValueType(
  value: unknown,
  type: string
): value is { type: string; value: unknown } {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'type' in value &&
    (value as { type: string }).type === type &&
    'value' in value
  );
}

/**
 * Type guard for string arrays
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Type guard for entity reference arrays
 */
function isEntityReferenceArray(
  value: unknown
): value is Array<{ entity_type: string; entity_id: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        'entity_type' in v &&
        'entity_id' in v
    )
  );
}

/**
 * Convert SoupProperty from DSS format to domain Property type
 *
 * SoupProperty is a simplified representation from the document storage service,
 * while Property is the full domain model used by UI components.
 */
export function soupPropertyToProperty(soupProperty: SoupProperty): Property {
  const definition = soupProperty.definition;
  const propertyValue = soupProperty.value;

  // Get static options for system properties (Status, Priority)
  // This allows tooltips to display human-readable values
  const options = getSystemPropertyOptions(definition.id);

  const baseProperty = {
    propertyId: nanoid(8), // SoupProperty doesn't have a property ID, generate one
    propertyDefinitionId: definition.id,
    displayName: definition.display_name,
    isMultiSelect: definition.is_multi_select,
    isMetadata: definition.is_metadata,
    isSystemProperty: definition.is_system,
    isRequired: definition.id === SYSTEM_PROPERTY_IDS.STATUS,
    options,
    owner: definition.owner,
    specificEntityType: definition.specific_entity_type,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
  };

  const valueType = definition.data_type as ValueType;

  // Handle each value type with proper type checking
  switch (valueType) {
    case 'STRING': {
      if (hasPropertyValueType(propertyValue, 'String')) {
        const stringVal = propertyValue.value;
        if (typeof stringVal === 'string' && stringVal) {
          return { ...baseProperty, valueType: 'STRING', value: stringVal };
        }
      }
      return { ...baseProperty, valueType: 'STRING', value: null };
    }

    case 'NUMBER': {
      if (hasPropertyValueType(propertyValue, 'Number')) {
        const numVal = propertyValue.value;
        if (
          typeof numVal === 'number' &&
          numVal !== undefined &&
          numVal !== null
        ) {
          return {
            ...baseProperty,
            valueType: 'NUMBER',
            value: parseFloat(numVal.toFixed(NUMBER_DECIMAL_PLACES)),
          };
        }
      }
      return { ...baseProperty, valueType: 'NUMBER', value: null };
    }

    case 'BOOLEAN': {
      if (hasPropertyValueType(propertyValue, 'Boolean')) {
        const boolVal = propertyValue.value;
        if (typeof boolVal === 'boolean') {
          return { ...baseProperty, valueType: 'BOOLEAN', value: boolVal };
        }
      }
      return { ...baseProperty, valueType: 'BOOLEAN', value: null };
    }

    case 'DATE': {
      if (hasPropertyValueType(propertyValue, 'Date')) {
        const dateVal = propertyValue.value;
        if (
          dateVal &&
          (typeof dateVal === 'string' || typeof dateVal === 'number')
        ) {
          return {
            ...baseProperty,
            valueType: 'DATE',
            value: new Date(dateVal),
          };
        }
      }
      return { ...baseProperty, valueType: 'DATE', value: null };
    }

    case 'SELECT_STRING':
    case 'SELECT_NUMBER': {
      if (hasPropertyValueType(propertyValue, 'SelectOption')) {
        const selectVal = propertyValue.value;
        if (isStringArray(selectVal)) {
          return {
            ...baseProperty,
            valueType,
            value: selectVal,
          };
        }
      }
      return { ...baseProperty, valueType, value: null };
    }

    case 'ENTITY': {
      if (hasPropertyValueType(propertyValue, 'EntityReference')) {
        const entityVal = propertyValue.value;
        if (isEntityReferenceArray(entityVal)) {
          return { ...baseProperty, valueType: 'ENTITY', value: entityVal };
        }
      }
      return { ...baseProperty, valueType: 'ENTITY', value: null };
    }

    case 'LINK': {
      if (hasPropertyValueType(propertyValue, 'Link')) {
        const linkVal = propertyValue.value;
        if (isStringArray(linkVal)) {
          return {
            ...baseProperty,
            valueType: 'LINK',
            value: linkVal,
          };
        }
      }
      return { ...baseProperty, valueType: 'LINK', value: null };
    }

    default: {
      // Fallback for unknown types - treat as string with null value
      return { ...baseProperty, valueType: 'STRING', value: null };
    }
  }
}

/**
 * Convert array of SoupProperty to Property array
 */
function _soupPropertiesToProperties(
  soupProperties: SoupProperty[]
): Property[] {
  return soupProperties.map(soupPropertyToProperty);
}

/**
 * Sort properties by the defined sort order (status, priority, assignees first)
 */
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

/**
 * Filter properties to only include key properties (status, priority, assignees)
 */
function filterKeyProperties(properties: Property[]): Property[] {
  return properties.filter((prop) =>
    PROPERTY_SORT_ORDER.includes(
      prop.propertyDefinitionId as (typeof PROPERTY_SORT_ORDER)[number]
    )
  );
}

/**
 * Get sorted key properties from a property array
 */
export function getSortedKeyProperties(properties: Property[]): Property[] {
  return sortProperties(filterKeyProperties(properties));
}
