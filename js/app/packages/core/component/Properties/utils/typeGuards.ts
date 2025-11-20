import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { Property } from '../types';

/**
 * Type guard to check if property is a LINK type
 */
export function isLinkProperty(
  property: Property
): property is Property & { valueType: 'LINK'; value: string[] | null } {
  return property.valueType === 'LINK';
}

/**
 * Type guard to check if property is a SELECT_STRING or SELECT_NUMBER type
 */
export function isSelectProperty(
  property: Property
): property is Property &
  (
    | { valueType: 'SELECT_STRING'; value: string[] | null }
    | { valueType: 'SELECT_NUMBER'; value: string[] | null }
  ) {
  return (
    property.valueType === 'SELECT_STRING' ||
    property.valueType === 'SELECT_NUMBER'
  );
}

/**
 * Type guard to check if property is an ENTITY type
 */
export function isEntityProperty(property: Property): property is Property & {
  valueType: 'ENTITY';
  value: EntityReference[] | null;
} {
  return property.valueType === 'ENTITY';
}

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
