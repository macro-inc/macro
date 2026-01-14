import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import type {
  BooleanProperty,
  DateProperty,
  EntityProperty,
  LinkProperty,
  MultiValueProperty,
  NumberProperty,
  Property,
  SelectNumberProperty,
  SelectProperty,
  SelectStringProperty,
  SingleValueProperty,
  StringProperty,
} from '../types';

export const isStringProperty = (
  property: Property
): property is StringProperty => {
  return property.valueType === 'STRING';
};

export const isNumberProperty = (
  property: Property
): property is NumberProperty => {
  return property.valueType === 'NUMBER';
};

export const isBooleanProperty = (
  property: Property
): property is BooleanProperty => {
  return property.valueType === 'BOOLEAN';
};

export const isDateProperty = (
  property: Property
): property is DateProperty => {
  return property.valueType === 'DATE';
};

export const isSelectStringProperty = (
  property: Property
): property is SelectStringProperty => {
  return property.valueType === 'SELECT_STRING';
};

export const isSelectNumberProperty = (
  property: Property
): property is SelectNumberProperty => {
  return property.valueType === 'SELECT_NUMBER';
};

export const isSelectProperty = (
  property: Property
): property is SelectProperty => {
  return (
    property.valueType === 'SELECT_STRING' ||
    property.valueType === 'SELECT_NUMBER'
  );
};

export const isEntityProperty = (
  property: Property
): property is EntityProperty => {
  return property.valueType === 'ENTITY';
};

export const isLinkProperty = (
  property: Property
): property is LinkProperty => {
  return property.valueType === 'LINK';
};

export const isSingleValueProperty = (
  property: Property
): property is SingleValueProperty => {
  return (
    property.valueType === 'STRING' ||
    property.valueType === 'NUMBER' ||
    property.valueType === 'BOOLEAN' ||
    property.valueType === 'DATE'
  );
};

export const isMultiValueProperty = (
  property: Property
): property is MultiValueProperty => {
  return (
    property.valueType === 'SELECT_STRING' ||
    property.valueType === 'SELECT_NUMBER' ||
    property.valueType === 'ENTITY' ||
    property.valueType === 'LINK'
  );
};

export const getStringValue = (property: StringProperty): string | null => {
  return property.value;
};

export const getNumberValue = (property: NumberProperty): number | null => {
  return property.value;
};

export const getBooleanValue = (property: BooleanProperty): boolean | null => {
  return property.value;
};

export const getDateValue = (property: DateProperty): Date | null => {
  return property.value;
};

export const getSelectStringValues = (
  property: SelectStringProperty
): string[] | null => {
  return property.value;
};

export const getSelectNumberValues = (
  property: SelectNumberProperty
): string[] | null => {
  return property.value;
};

/**
 * Safely extract link values from a property
 * Returns empty array if property is not LINK type or value is null
 */
export function getLinkValues(property: Property): string[] {
  if (isLinkProperty(property)) {
    return property.value ?? [];
  }
  return [];
}

/**
 * Safely extract select values from a property
 * Returns empty array if property is not SELECT type or value is null
 */
export function getSelectValues(property: Property): string[] {
  if (isSelectProperty(property)) {
    return property.value ?? [];
  }
  return [];
}

/**
 * Safely extract entity references from a property
 * Returns empty array if property is not ENTITY type or value is null
 */
export function getEntityValues(property: Property): EntityReference[] {
  if (isEntityProperty(property)) {
    return property.value ?? [];
  }
  return [];
}

/**
 * Type guard to check if a value is a string array
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Type guard to check if a value is an EntityReference array
 */
export function isEntityReferenceArray(
  value: unknown
): value is EntityReference[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (ref): ref is EntityReference =>
      ref !== null &&
      typeof ref === 'object' &&
      'entity_id' in ref &&
      'entity_type' in ref
  );
}

/**
 * Type guard to narrow PropertyDefinitionResponse to PropertyDefinition
 * PropertyDefinitionWithOptions has { definition, property_options } structure
 * PropertyDefinition has { id, data_type, ... } directly
 */
export function isPropertyDefinition(
  p: PropertyDefinitionResponse
): p is PropertyDefinition {
  return !('definition' in p);
}

export const hasValue = (property: Property): boolean => {
  if (property.value === null) {
    return false;
  }

  if (Array.isArray(property.value)) {
    return property.value.length > 0;
  }

  return true;
};

export const hasSingleValue = (property: MultiValueProperty): boolean => {
  return property.value !== null && property.value.length === 1;
};

export const hasMultiValue = (property: MultiValueProperty): boolean => {
  return property.value !== null && property.value.length > 1;
};
