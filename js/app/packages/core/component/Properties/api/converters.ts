import type { PropertyValue } from '@service-properties/generated/schemas/propertyValue';
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
    options: apiProperty.options ?? undefined,
    owner: apiProperty.definition.owner,
    specificEntityType: apiProperty.definition.specific_entity_type,
    createdAt: apiProperty.property.created_at,
    updatedAt: apiProperty.property.updated_at,
  };

  const propertyValue = apiProperty.value;
  const valueType = apiProperty.definition.data_type as ValueType;

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
        if (
          Array.isArray(selectVal) &&
          selectVal.every((v) => typeof v === 'string')
        ) {
          return {
            ...baseProperty,
            valueType,
            value: selectVal as string[],
          };
        }
      }
      return { ...baseProperty, valueType, value: null };
    }

    case 'ENTITY': {
      if (hasPropertyValueType(propertyValue, 'EntityReference')) {
        const entityVal = propertyValue.value;
        if (Array.isArray(entityVal)) {
          const refs: EntityReference[] = [];
          for (const ref of entityVal) {
            if (
              ref &&
              typeof ref === 'object' &&
              'entity_id' in ref &&
              'entity_type' in ref
            ) {
              refs.push(ref as EntityReference);
            }
          }
          return { ...baseProperty, valueType: 'ENTITY', value: refs };
        }
      }
      return { ...baseProperty, valueType: 'ENTITY', value: null };
    }

    case 'LINK': {
      if (hasPropertyValueType(propertyValue, 'Link')) {
        const linkVal = propertyValue.value;
        if (
          Array.isArray(linkVal) &&
          linkVal.every((v) => typeof v === 'string')
        ) {
          return {
            ...baseProperty,
            valueType: 'LINK',
            value: linkVal as string[],
          };
        }
      }
      return { ...baseProperty, valueType: 'LINK', value: null };
    }

    default: {
      const exhaustiveCheck: never = valueType;
      throw new Error(
        `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
      );
    }
  }
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
  switch (apiValues.valueType) {
    case 'STRING':
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'string',
        value: apiValues.value,
      };

    case 'NUMBER':
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'number',
        value: parseFloat(apiValues.value.toFixed(NUMBER_DECIMAL_PLACES)),
      };

    case 'DATE':
      if (apiValues.value == null) {
        return null;
      }
      return {
        type: 'date',
        value: apiValues.value,
      };

    case 'BOOLEAN':
      if (apiValues.value == null) {
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

    default: {
      const exhaustiveCheck: never = apiValues;
      throw new Error(
        `Unsupported value type: ${(exhaustiveCheck as { valueType: string }).valueType}`
      );
    }
  }
}
