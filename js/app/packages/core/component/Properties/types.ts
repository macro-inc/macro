/**
 * Properties Component Type Definitions
 *
 * Type Hierarchy:
 * 1. Generated types (from OpenAPI) - Source of truth from backend
 *    - EntityPropertyWithDefinition, PropertyValue, SetPropertyValue, etc.
 * 2. Domain types (this file) - Convenience types for frontend business logic
 *    - Property (flattened for UI), PropertyApiValues (for value collection)
 * 3. UI Component Props - React/SolidJS component interfaces
 *
 * Prefer using generated types where possible. Domain types exist for:
 * - UI convenience (flattened Property structure)
 * - Intermediate transformations (PropertyApiValues)
 * - Legacy compatibility during migration
 */
import type { BlockName } from '@core/block';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOwner } from '@service-properties/generated/schemas/propertyOwner';

/**
 * Frontend value type discriminator aligned with backend DataType
 * Uses UPPERCASE to match backend enum values exactly
 */
export type ValueType =
  | 'STRING'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT_STRING'
  | 'SELECT_NUMBER'
  | 'ENTITY'
  | 'LINK';

/**
 * UI layer property with discriminated union for type-safe values
 *
 * Note: All value types use `value: T | null` or `value: T[] | null` (not optional properties)
 * This reflects that unset values are explicitly `null` rather than `undefined`.
 *
 * @see EntityPropertyWithDefinition - Backend structured type
 * @see PropertyValue - Backend discriminated union for values
 */
export type Property = {
  propertyId: string;
  propertyDefinitionId: string;
  displayName: string;
  isMultiSelect: boolean;
  isMetadata?: boolean;
  isSystemProperty?: boolean;
  options?: PropertyOption[];
  owner: PropertyOwner;
  specificEntityType?: EntityType | null;
  createdAt: string;
  updatedAt: string;
} & ( // Single-value types
  | { valueType: 'STRING'; value: string | null }
  | { valueType: 'NUMBER'; value: number | null }
  | { valueType: 'BOOLEAN'; value: boolean | null }
  | { valueType: 'DATE'; value: Date | null }
  // Multi-value types (select values are option IDs, not display values)
  | { valueType: 'SELECT_STRING'; value: string[] | null }
  | { valueType: 'SELECT_NUMBER'; value: string[] | null }
  | { valueType: 'ENTITY'; value: EntityReference[] | null }
  | { valueType: 'LINK'; value: string[] | null }
);

type PropertyOfType<T extends ValueType> = Extract<Property, { valueType: T }>;

export type StringProperty = PropertyOfType<'STRING'>;
export type NumberProperty = PropertyOfType<'NUMBER'>;
export type BooleanProperty = PropertyOfType<'BOOLEAN'>;
export type DateProperty = PropertyOfType<'DATE'>;
export type SelectStringProperty = PropertyOfType<'SELECT_STRING'>;
export type SelectNumberProperty = PropertyOfType<'SELECT_NUMBER'>;
export type EntityProperty = PropertyOfType<'ENTITY'>;
export type LinkProperty = PropertyOfType<'LINK'>;

/** Properties that hold a single primitive value */
export type SingleValueProperty =
  | StringProperty
  | NumberProperty
  | BooleanProperty
  | DateProperty;

/** Properties that hold multiple values (arrays) */
export type MultiValueProperty =
  | SelectStringProperty
  | SelectNumberProperty
  | EntityProperty
  | LinkProperty;

export type SelectProperty = SelectStringProperty | SelectNumberProperty;

/**
 * Domain type for property definitions (camelCase, frontend-friendly)
 *
 * This is the UI layer representation of a property definition.
 * Use `toPropertyDefinitionDomain` to transform from API types.
 *
 * Note: Uses `valueType` to match the `Property` type, enabling shared
 * components like `PropertyDataTypeIcon` to work with both types.
 *
 * @see PropertyDefinition - Generated API type (snake_case)
 * @see Property - Domain type for property instances with values
 */
export type PropertyDefinitionDomain = {
  id: string;
  displayName: string;
  valueType: ValueType;
  isMultiSelect: boolean;
  isMetadata: boolean;
  isSystem: boolean;
  owner: PropertyOwner;
  specificEntityType?: EntityType | null;
  options?: PropertyOption[];
  createdAt: string;
  updatedAt: string;
};

export type PropertiesPanelProps = {
  blockType: BlockName;
  closePropertiesView?: () => void;
  blockElement?: HTMLElement;
  canEdit: boolean;
  entityType: EntityType;
  documentName?: string;
  pinnedPropertyIds?: () => string[];
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  onRefresh?: () => void;
};

export type PropertyEditorProps = {
  property: Property;
  onClose: () => void;
  onSaved: () => void;
  anchorRef?: HTMLElement;
  entityType: EntityType;
};

export type PropertySelectorProps = {
  isOpen: boolean;
  onClose: () => void;
  existingPropertyIds: () => string[];
};

// Re-export generated API types from service-properties
// Note: EntityType is NOT re-exported to avoid type conflicts with @service-connection
// Files that need EntityType should import it directly from @service-properties/generated/schemas/entityType
export type { DataType } from '@service-properties/generated/schemas/dataType';
export type { EntityPropertiesResponse } from '@service-properties/generated/schemas/entityPropertiesResponse';
export type { EntityPropertyWithDefinition } from '@service-properties/generated/schemas/entityPropertyWithDefinition';
export type { EntityReference } from '@service-properties/generated/schemas/entityReference';
export type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
export type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
export type { PropertyOptionValue } from '@service-properties/generated/schemas/propertyOptionValue';
export type { PropertyValue } from '@service-properties/generated/schemas/propertyValue';
export type { SetPropertyValue } from '@service-properties/generated/schemas/setPropertyValue';

/**
 * Domain layer type for property value updates
 * Maps to SetPropertyValue for API submission
 *
 * Discriminated union ensures only one value type can exist at a time
 */
export type PropertyApiValues =
  | { valueType: 'STRING'; value: string | null }
  | { valueType: 'NUMBER'; value: number | null }
  | { valueType: 'DATE'; value: string | null }
  | { valueType: 'BOOLEAN'; value: boolean | null }
  | { valueType: 'SELECT_STRING'; values: string[] | null }
  | { valueType: 'SELECT_NUMBER'; values: string[] | null }
  | { valueType: 'ENTITY'; refs: EntityReference[] | null }
  | { valueType: 'LINK'; values: string[] | null };

// Result type for API responses
export type ApiError = {
  code: string;
  message: string;
};

export type Result<T, E = ApiError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
