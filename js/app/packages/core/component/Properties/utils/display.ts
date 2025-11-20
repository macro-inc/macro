import type { Property } from '../types';

/**
 * Get dropdown options for property data types
 * This is the single source of truth for all property type labels
 */
export const getPropertyDataTypeDropdownOptions = () => [
  { value: 'string' as const, label: 'Input' },
  { value: 'number' as const, label: 'Input (Number)' },
  { value: 'boolean' as const, label: 'Checkbox' },
  { value: 'date' as const, label: 'Date' },
  { value: 'link' as const, label: 'Link' },
  { value: 'select_string' as const, label: 'Option' },
  { value: 'select_number' as const, label: 'Option (Number)' },
  { value: 'entity:USER' as const, label: 'User' },
  { value: 'entity:DOCUMENT' as const, label: 'Document' },
  { value: 'entity:CHANNEL' as const, label: 'Channel' },
  { value: 'entity:PROJECT' as const, label: 'Project' },
  { value: 'entity:CHAT' as const, label: 'Chat' },
  // { value: 'entity:THREAD' as const, label: 'Thread' }, // Not yet supported
  { value: 'entity' as const, label: 'Any Entity' },
];

/**
 * Get display name for a property definition's data type
 * Uses the same labels as the property creation dropdown for consistency
 *
 * Handles both backend UPPERCASE and frontend lowercase data_type values
 */
export const getPropertyDefinitionTypeDisplay = (property: {
  dataType: string;
  specificEntityType?: string | null;
  isMultiSelect: boolean;
}): string => {
  if (!property) {
    return 'Unknown';
  }

  // Map from camelCase parameters to snake_case for internal use
  const data_type = property.dataType;
  const specific_entity_type = property.specificEntityType;
  const is_multi_select = property.isMultiSelect;

  if (!data_type || typeof data_type !== 'string') {
    return 'Unknown';
  }

  // Normalize to lowercase for comparison with dropdown options
  const dataTypeLower = data_type.toLowerCase();

  // Get the base label from dropdown options
  const dropdownOptions = getPropertyDataTypeDropdownOptions();
  let display: string;

  if (dataTypeLower === 'entity') {
    // For specific entity types, find the matching dropdown option
    display =
      dropdownOptions.find(
        (opt) => opt.value === `entity:${specific_entity_type}`
      )?.label || `${dataTypeLower[0].toUpperCase() + dataTypeLower.slice(1)}`;
  } else {
    // For other types, find the matching dropdown option
    const option = dropdownOptions.find((opt) => opt.value === dataTypeLower);
    display =
      option?.label ||
      (typeof data_type === 'string'
        ? data_type.replace(/_/g, ' ')
        : 'Unknown');
  }

  // Add multi indicator
  if (['select_string', 'select_number', 'link'].includes(dataTypeLower)) {
    display = `${is_multi_select ? 'Multi' : 'Single'} ${display}`;
  } else if (dataTypeLower === 'entity') {
    display = `${is_multi_select ? 'Multi' : 'Single'}-Select ${display}`;
  }

  return display;
};

/**
 * Get display name for a property's value type
 * For entity types with specificEntityType, returns the specific type (e.g., "User", "Document")
 */
export const getValueTypeDisplay = (
  property: Pick<Property, 'valueType' | 'specificEntityType'>
): string => {
  // For entity types, use the specific entity type if available
  if (property.valueType === 'ENTITY' && property.specificEntityType) {
    // Convert from UPPERCASE to Title Case
    const entityTypeLower = property.specificEntityType.toLowerCase();
    return entityTypeLower.charAt(0).toUpperCase() + entityTypeLower.slice(1);
  }

  switch (property.valueType) {
    case 'STRING':
      return 'Text';
    case 'NUMBER':
      return 'Number';
    case 'DATE':
      return 'Date';
    case 'BOOLEAN':
      return 'Boolean';
    case 'ENTITY':
      return 'Entity';
    case 'SELECT_STRING':
      return 'Select (Text)';
    case 'SELECT_NUMBER':
      return 'Select (Number)';
    case 'LINK':
      return 'Link';
    default:
      return property.valueType;
  }
};
