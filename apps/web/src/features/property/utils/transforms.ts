import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { match } from 'ts-pattern';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '../types';

/** The property as it reads once `apiValues` is saved. */
export function withApiValues(
  property: Property,
  apiValues: PropertyApiValues
): Property {
  return (
    match([property, apiValues])
      .with(
        [{ valueType: 'STRING' }, { valueType: 'STRING' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.value })
      )
      .with(
        [{ valueType: 'NUMBER' }, { valueType: 'NUMBER' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.value })
      )
      .with(
        [{ valueType: 'BOOLEAN' }, { valueType: 'BOOLEAN' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.value })
      )
      .with(
        [{ valueType: 'DATE' }, { valueType: 'DATE' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.value })
      )
      .with(
        [{ valueType: 'DATE_RANGE' }, { valueType: 'DATE_RANGE' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.value })
      )
      .with(
        [{ valueType: 'SELECT_STRING' }, { valueType: 'SELECT_STRING' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.values })
      )
      .with(
        [{ valueType: 'SELECT_NUMBER' }, { valueType: 'SELECT_NUMBER' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.values })
      )
      .with(
        [{ valueType: 'ENTITY' }, { valueType: 'ENTITY' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.refs })
      )
      .with(
        [{ valueType: 'LINK' }, { valueType: 'LINK' }],
        ([property, apiValues]) => ({ ...property, value: apiValues.values })
      )
      // Values of another type can't be shown on this property.
      .otherwise(([property]) => property)
  );
}

/**
 * Transforms a backend PropertyDefinition (snake_case) to the frontend
 * PropertyDefinitionDomain (camelCase).
 *
 * Use this at the boundary between API responses and UI components.
 *
 * @param definition - The API property definition
 * @param options - Optional property options (from PropertyDefinitionWithOptions)
 * @returns The domain representation for UI consumption
 */
export function toPropertyDefinitionDomain(
  definition: PropertyDefinition,
  options?: PropertyOption[]
): PropertyDefinitionDomain {
  return {
    id: definition.id,
    displayName: definition.display_name,
    valueType: definition.data_type,
    isMultiSelect: definition.is_multi_select,
    isMetadata: definition.is_metadata,
    isSystem: definition.is_system,
    owner: definition.owner,
    specificEntityType: definition.specific_entity_type,
    options,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
  };
}
