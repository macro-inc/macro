import type { PropertyValue } from '@service-properties/generated/schemas/propertyValue';
import { match } from 'ts-pattern';
import {
  timeRangeFromInstants,
  timeRangeToInstants,
} from '../../database/core/cell-date-range';
import { NUMBER_DECIMAL_PLACES } from '../constants';
import type {
  DateRangeValue,
  EntityPropertyWithDefinition,
  EntityReference,
  Property,
  PropertyApiValues,
  SetPropertyValue,
  ValueType,
} from '../types';
import { isEntityReferenceArray, isStringArray } from '../utils/typeGuards';

/**
 * Normalized flat value type for PropertyApiValues conversion
 * Contains the actual value with proper TypeScript typing based on the PropertyApiValues type
 */
type NormalizedPropertyValue =
  | { type: 'STRING'; value: string }
  | { type: 'NUMBER'; value: number }
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'DATE'; value: Date }
  | { type: 'DATE_RANGE'; value: DateRangeValue }
  | { type: 'SELECT_OPTION'; value: string[] }
  | { type: 'ENTITY_REFERENCE'; value: EntityReference[] }
  | { type: 'LINK'; value: string[] }
  | { type: 'EMPTY'; value: null };

/**
 * Type guard to check if PropertyValue has a specific type
 */
function hasPropertyValueType(
  value: PropertyValue | null | undefined,
  type: string
): value is PropertyValue & { type: string; value: unknown } {
  return (
    value !== null &&
    value !== undefined &&
    'type' in value &&
    value.type === type &&
    'value' in value
  );
}

/**
 * Convert EntityPropertyWithDefinition from API format to domain Property type
 *
 * Transforms the nested API response structure into a flat, strongly-typed domain model.
 * Handles all value types with proper type guards and formatting.
 */
export function entityPropertyFromApi(
  apiProperty: EntityPropertyWithDefinition
): Property {
  const baseProperty = {
    propertyId: apiProperty.property.id,
    propertyDefinitionId: apiProperty.definition.id,
    displayName: apiProperty.definition.display_name,
    isMultiSelect: apiProperty.definition.is_multi_select,
    isMetadata: apiProperty.definition.is_metadata,
    isSystemProperty: apiProperty.definition.is_system,
    options: apiProperty.options ?? undefined,
    owner: apiProperty.definition.owner,
    specificEntityType: apiProperty.definition.specific_entity_type,
    createdAt: apiProperty.property.created_at,
    updatedAt: apiProperty.property.updated_at,
  };

  const propertyValue = apiProperty.value;
  const valueType = (
    apiProperty.definition.data_type === 'TAG'
      ? 'SELECT_STRING'
      : apiProperty.definition.data_type
  ) as ValueType;

  // Handle each value type with proper type checking
  return match(valueType)
    .with('STRING', (): Property => {
      if (hasPropertyValueType(propertyValue, 'String')) {
        const stringVal = propertyValue.value;
        if (typeof stringVal === 'string' && stringVal) {
          return { ...baseProperty, valueType: 'STRING', value: stringVal };
        }
      }
      return { ...baseProperty, valueType: 'STRING', value: null };
    })
    .with('NUMBER', (): Property => {
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
    })
    .with('BOOLEAN', (): Property => {
      if (hasPropertyValueType(propertyValue, 'Boolean')) {
        const boolVal = propertyValue.value;
        if (typeof boolVal === 'boolean') {
          return { ...baseProperty, valueType: 'BOOLEAN', value: boolVal };
        }
      }
      return { ...baseProperty, valueType: 'BOOLEAN', value: null };
    })
    .with('DATE', (): Property => {
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
    })
    .with(
      'DATE_RANGE',
      (): Property => ({
        ...baseProperty,
        valueType: 'DATE_RANGE',
        value:
          (propertyValue?.type === 'DateRange' &&
            timeRangeFromInstants(propertyValue.value)) ||
          null,
      })
    )
    .with('SELECT_STRING', 'SELECT_NUMBER', (valueType): Property => {
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
    })
    .with('ENTITY', (): Property => {
      if (hasPropertyValueType(propertyValue, 'EntityReference')) {
        const entityVal = propertyValue.value;
        if (isEntityReferenceArray(entityVal)) {
          return { ...baseProperty, valueType: 'ENTITY', value: entityVal };
        }
      }
      return { ...baseProperty, valueType: 'ENTITY', value: null };
    })
    .with('LINK', (): Property => {
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
    })
    .otherwise((valueType): Property => {
      {
        const exhaustiveCheck: never = valueType;
        throw new Error(
          `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
        );
      }
    });
}

/**
 * Convert PropertyApiValues from domain format to API SetPropertyValue format
 *
 * Transforms typed property values into the API's expected format, handling:
 * - Primitive types (string, number, date, boolean)
 * - Select types (single and multi-select for both string and number options)
 * - Entity references (single and multi-entity for all entity types)
 * - Number formatting to 4 decimal places
 */
export function propertyValueToApi(
  apiValues: PropertyApiValues,
  isMultiSelect: boolean
): SetPropertyValue | null {
  return match(apiValues)
    .with({ valueType: 'STRING' }, (apiValues): SetPropertyValue | null => {
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'string',
        value: apiValues.value,
      };
    })
    .with({ valueType: 'NUMBER' }, (apiValues): SetPropertyValue | null => {
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'number',
        value: parseFloat(apiValues.value.toFixed(NUMBER_DECIMAL_PLACES)),
      };
    })
    .with({ valueType: 'DATE' }, (apiValues): SetPropertyValue | null => {
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'date',
        value: apiValues.value.toISOString(),
      };
    })
    .with({ valueType: 'DATE_RANGE' }, (apiValues): SetPropertyValue | null => {
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'date_range',
        value: timeRangeToInstants(apiValues.value),
      };
    })
    .with({ valueType: 'BOOLEAN' }, (apiValues): SetPropertyValue | null => {
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'boolean',
        value: apiValues.value,
      };
    })
    .with(
      { valueType: 'SELECT_STRING' },
      { valueType: 'SELECT_NUMBER' },
      (apiValues): SetPropertyValue | null => {
        if (!apiValues.values || apiValues.values.length === 0) {
          return null;
        }
        if (isMultiSelect) {
          return {
            type: 'multi_select_option',
            option_ids: apiValues.values,
          };
        }
        return {
          type: 'select_option',
          option_id: apiValues.values[0],
        };
      }
    )
    .with({ valueType: 'ENTITY' }, (apiValues): SetPropertyValue | null => {
      if (!apiValues.refs || apiValues.refs.length === 0) {
        return null;
      }
      if (isMultiSelect) {
        return {
          type: 'multi_entity_reference',
          references: apiValues.refs,
        };
      }
      return {
        type: 'entity_reference',
        reference: apiValues.refs[0],
      };
    })
    .with({ valueType: 'LINK' }, (apiValues): SetPropertyValue | null => {
      if (!apiValues.values || apiValues.values.length === 0) {
        return null;
      }
      if (isMultiSelect) {
        return {
          type: 'multi_link',
          urls: apiValues.values,
        };
      }
      return {
        type: 'link',
        url: apiValues.values[0],
      };
    })
    .otherwise((apiValues): SetPropertyValue | null => {
      {
        const exhaustiveCheck: never = apiValues;
        throw new Error(
          `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
        );
      }
    });
}

/**
 * Convert PropertyApiValues from domain format to a normalized flat value structure
 *
 * Transforms the PropertyApiValues discriminated union into a simplified format with:
 * - Consistent type field naming
 * - Properly typed value field
 * - Normalized handling of all value types including empty/null values
 */
export function propertyApiValuesToNormalized(
  apiValues: PropertyApiValues | null | undefined
): NormalizedPropertyValue {
  // Handle null/undefined values
  if (!apiValues) {
    return { type: 'EMPTY', value: null };
  }

  // Handle each PropertyApiValues type
  return match(apiValues)
    .with({ valueType: 'STRING' }, (apiValues): NormalizedPropertyValue => {
      if (apiValues.value !== null && typeof apiValues.value === 'string') {
        return { type: 'STRING', value: apiValues.value };
      }
      return { type: 'EMPTY', value: null };
    })
    .with({ valueType: 'NUMBER' }, (apiValues): NormalizedPropertyValue => {
      if (
        apiValues.value !== null &&
        typeof apiValues.value === 'number' &&
        !isNaN(apiValues.value)
      ) {
        return {
          type: 'NUMBER',
          value: parseFloat(apiValues.value.toFixed(NUMBER_DECIMAL_PLACES)),
        };
      }
      return { type: 'EMPTY', value: null };
    })
    .with({ valueType: 'BOOLEAN' }, (apiValues): NormalizedPropertyValue => {
      if (apiValues.value !== null && typeof apiValues.value === 'boolean') {
        return { type: 'BOOLEAN', value: apiValues.value };
      }
      return { type: 'EMPTY', value: null };
    })
    .with({ valueType: 'DATE' }, (apiValues): NormalizedPropertyValue => {
      if (apiValues.value !== null && apiValues.value instanceof Date) {
        if (!isNaN(apiValues.value.getTime())) {
          return { type: 'DATE', value: apiValues.value };
        }
      }
      return { type: 'EMPTY', value: null };
    })
    .with(
      { valueType: 'DATE_RANGE' },
      (apiValues): NormalizedPropertyValue =>
        apiValues.value
          ? { type: 'DATE_RANGE', value: apiValues.value }
          : { type: 'EMPTY', value: null }
    )
    .with(
      { valueType: 'SELECT_STRING' },
      { valueType: 'SELECT_NUMBER' },
      (apiValues): NormalizedPropertyValue => {
        if (apiValues.values && isStringArray(apiValues.values)) {
          return { type: 'SELECT_OPTION', value: apiValues.values };
        }
        return { type: 'EMPTY', value: null };
      }
    )
    .with({ valueType: 'ENTITY' }, (apiValues): NormalizedPropertyValue => {
      if (apiValues.refs && isEntityReferenceArray(apiValues.refs)) {
        return { type: 'ENTITY_REFERENCE', value: apiValues.refs };
      }
      return { type: 'EMPTY', value: null };
    })
    .with({ valueType: 'LINK' }, (apiValues): NormalizedPropertyValue => {
      if (apiValues.values && isStringArray(apiValues.values)) {
        return { type: 'LINK', value: apiValues.values };
      }
      return { type: 'EMPTY', value: null };
    })
    .otherwise((apiValues): NormalizedPropertyValue => {
      {
        const exhaustiveCheck: never = apiValues;
        throw new Error(
          `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
        );
      }
    });
}
