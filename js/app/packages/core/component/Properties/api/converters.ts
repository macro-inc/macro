import { NUMBER_DECIMAL_PLACES } from '../constants';
import type {
  EntityPropertyWithDefinition,
  EntityReference,
  Property,
  PropertyApiValues,
  SetPropertyValue,
  ValueType,
} from '../types';

/**
 * Convert domain PropertyApiValues to API format
 *
 * Transforms typed property values into the API's expected format, handling:
 * - Primitive types (string, number, date, boolean)
 * - Select types (single and multi-select for both string and number options)
 * - Entity references (single and multi-entity for all entity types)
 * - Number formatting to 4 decimal places
 *
 * @param apiValues - The property values in domain format (discriminated union)
 * @param isMultiSelect - Whether this property supports multiple selections
 * @returns SetPropertyValue for API submission, or null to unset the value
 *
 * @example
 * // String value
 * toApiFormat({ valueType: 'string', value: 'Hello' }, false)
 * // Returns: { type: 'string', value: 'Hello' }
 *
 * @example
 * // Multi-select
 * toApiFormat({ valueType: 'select_string', values: ['opt1', 'opt2'] }, true)
 * // Returns: { type: 'multi_select_option', option_ids: ['opt1', 'opt2'] }
 *
 * @example
 * // Unset value
 * toApiFormat({ valueType: 'string', value: null }, false)
 * // Returns: null
 */
export function toApiFormat(
  apiValues: PropertyApiValues,
  isMultiSelect: boolean
): SetPropertyValue | null {
  switch (apiValues.valueType) {
    case 'STRING':
      if (apiValues.value === null) {
        return null;
      }
      return {
        type: 'string',
        value: apiValues.value,
      };

    case 'NUMBER':
      if (apiValues.value === null) {
        return null;
      }
      return {
        type: 'number',
        value: parseFloat(apiValues.value.toFixed(NUMBER_DECIMAL_PLACES)),
      };

    case 'DATE':
      if (apiValues.value === null) {
        return null;
      }
      return {
        type: 'date',
        value: apiValues.value,
      };

    case 'BOOLEAN':
      if (apiValues.value === null) {
        return null;
      }
      return {
        type: 'boolean',
        value: apiValues.value,
      };

    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
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

    case 'ENTITY':
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

    case 'LINK':
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

    default:
      const exhaustiveCheck: never = apiValues;
      throw new Error(
        `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
      );
  }
}

/**
 * Convert API property response to domain Property type
 *
 * Transforms the nested API response structure into a flat, strongly-typed domain model.
 *
 * Key transformations:
 * - Parses discriminated union from API's PropertyValue structure
 * - Formats numbers to 4 decimal places
 * - Distinguishes "property not set" (undefined) from "property set but empty" ([])
 *
 * @param apiProperty - Raw API property response with nested structure
 * @returns Flat Property object with typed value arrays
 *
 * @example
 * // API response with string value
 * fromApiFormat({
 *   id: 'prop1',
 *   values: [{ value: { type: 'string', value: 'Hello' } }],
 *   definition: { display_name: 'Name', data_type: 'string', ... }
 * })
 * // Returns: { propertyId: 'prop1', stringValue: ['Hello'], ... }
 */
export function fromApiFormat(
  apiProperty: EntityPropertyWithDefinition
): Property {
  const baseProperty = {
    propertyId: apiProperty.property.id,
    propertyDefinitionId: apiProperty.definition.id,
    displayName: apiProperty.definition.display_name,
    isMultiSelect: apiProperty.definition.is_multi_select,
    isMetadata: apiProperty.definition.is_metadata,
    options: apiProperty.options ?? undefined, // Convert null to undefined
    owner: apiProperty.definition.owner,
    specificEntityType: apiProperty.definition.specific_entity_type,
    // Timestamps
    createdAt: apiProperty.property.created_at,
    updatedAt: apiProperty.property.updated_at,
  };

  const propertyValue = apiProperty.value;
  const valueType = apiProperty.definition.data_type as ValueType;

  // Parse and return the appropriate discriminated union type
  // undefined = "property not set", empty array = "set but empty", value = "has data"
  switch (valueType) {
    case 'STRING':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'String' &&
        'value' in propertyValue
      ) {
        const stringVal = propertyValue.value;
        if (stringVal && typeof stringVal === 'string') {
          return { ...baseProperty, valueType: 'STRING', value: stringVal };
        }
      }
      return { ...baseProperty, valueType: 'STRING', value: undefined };

    case 'NUMBER':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'Number' &&
        'value' in propertyValue
      ) {
        const numVal = propertyValue.value;
        if (
          numVal !== undefined &&
          numVal !== null &&
          typeof numVal === 'number'
        ) {
          return {
            ...baseProperty,
            valueType: 'NUMBER',
            value: parseFloat(numVal.toFixed(NUMBER_DECIMAL_PLACES)),
          };
        }
      }
      return { ...baseProperty, valueType: 'NUMBER', value: undefined };

    case 'BOOLEAN':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'Boolean' &&
        'value' in propertyValue
      ) {
        const boolVal = propertyValue.value;
        if (typeof boolVal === 'boolean') {
          return { ...baseProperty, valueType: 'BOOLEAN', value: boolVal };
        }
      }
      return { ...baseProperty, valueType: 'BOOLEAN', value: undefined };

    case 'DATE':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'Date' &&
        'value' in propertyValue
      ) {
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
      return { ...baseProperty, valueType: 'DATE', value: undefined };

    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'SelectOption' &&
        'value' in propertyValue
      ) {
        const selectVal = propertyValue.value;
        if (Array.isArray(selectVal)) {
          return {
            ...baseProperty,
            valueType,
            value: selectVal,
          };
        }
      }
      return { ...baseProperty, valueType, value: undefined };

    case 'ENTITY':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'EntityReference' &&
        'value' in propertyValue
      ) {
        const entityVal = propertyValue.value;
        if (Array.isArray(entityVal)) {
          const refs: EntityReference[] = [];
          entityVal.forEach((ref: unknown) => {
            if (
              ref &&
              typeof ref === 'object' &&
              'entity_id' in ref &&
              'entity_type' in ref
            ) {
              refs.push(ref as EntityReference);
            }
          });
          return { ...baseProperty, valueType: 'ENTITY', value: refs };
        }
      }
      return { ...baseProperty, valueType: 'ENTITY', value: undefined };

    case 'LINK':
      if (
        propertyValue &&
        'type' in propertyValue &&
        propertyValue.type === 'Link' &&
        'value' in propertyValue
      ) {
        const linkVal = propertyValue.value;
        // Link values are always returned as arrays from the API
        if (Array.isArray(linkVal)) {
          return { ...baseProperty, valueType: 'LINK', value: linkVal };
        }
      }
      return { ...baseProperty, valueType: 'LINK', value: undefined };
  }
}
