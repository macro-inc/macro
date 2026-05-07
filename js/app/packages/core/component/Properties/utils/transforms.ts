import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { nanoid } from 'nanoid';
import type { Property, PropertyDefinitionDomain, ValueType } from '../types';

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
    valueType: definition.data_type as ValueType,
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

export function propertyDefinitionDomainToProperty(
  propertyDefinition: PropertyDefinitionDomain
): Property {
  return {
    propertyId: nanoid(8),
    propertyDefinitionId: propertyDefinition.id,
    displayName: propertyDefinition.displayName,
    isMultiSelect: propertyDefinition.isMultiSelect,
    isMetadata: propertyDefinition.isMetadata,
    isSystemProperty: propertyDefinition.isSystem,
    options: propertyDefinition.options,
    owner: propertyDefinition.owner,
    specificEntityType: propertyDefinition.specificEntityType,
    createdAt: propertyDefinition.createdAt,
    updatedAt: propertyDefinition.updatedAt,
    valueType: propertyDefinition.valueType,
    value: null,
  };
}
