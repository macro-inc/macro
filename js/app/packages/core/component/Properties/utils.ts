import { createEffect, onCleanup } from 'solid-js';
import { FOCUS_CONFIG, NUMBER_DECIMAL_PLACES } from './constants';
import type { Property, PropertyOptionValue } from './types';

type PropertyValueUnion = string | number | Date | boolean;

/**
 * Format a number to show up to 4 decimal places
 * Uses exponential notation for numbers beyond safe integer range
 */
export function formatNumber(value: number): string {
  // Use exponential notation for numbers beyond 15 digits
  // 15 is the largest js can handle
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-15)) {
    return value.toExponential(NUMBER_DECIMAL_PLACES);
  }
  // Round to 4 decimal places and remove trailing zeros
  const rounded = parseFloat(value.toFixed(NUMBER_DECIMAL_PLACES));
  return rounded.toString();
}

/**
 * Format a date value for display
 */
export function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;

  // Parse as local date to avoid timezone issues
  const dateStr = date.toISOString().split('T')[0];
  const localDate = new Date(dateStr + 'T00:00:00');

  return localDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a boolean value for display
 */
export function formatBoolean(value: boolean): string {
  return value ? 'True' : 'False';
}

/**
 * Extract domain from a URL for display
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Normalize a URL by adding https:// if no protocol is present
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Check if URL has a protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/**
 * Validate if a string is a valid URL
 * Requires a proper domain with TLD (e.g., example.com)
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Check if hostname has at least one dot (for TLD) or is localhost
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // Must have at least one dot for TLD
    if (!hostname.includes('.')) {
      return false;
    }

    // Must have something before and after the dot
    const parts = hostname.split('.');
    if (parts.some((part) => part.length === 0)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Format a property value for display
 * Handles all value types including looking up select options by ID
 * Returns '—' for undefined/null values
 */
export const formatPropertyValue = (
  property: Property,
  value: PropertyValueUnion | string | undefined
): string => {
  // Handle undefined/null values
  if (value === undefined || value === null) {
    return '';
  }

  // For select types, value is an option ID - look it up in property.options
  if (
    property.valueType === 'SELECT_STRING' ||
    property.valueType === 'SELECT_NUMBER'
  ) {
    const optionId = typeof value === 'string' ? value : String(value);
    return formatOptionValueById(optionId, property.options);
  }

  if (property.valueType === 'DATE' && value instanceof Date) {
    return formatDate(value);
  }

  if (property.valueType === 'BOOLEAN' && typeof value === 'boolean') {
    return formatBoolean(value);
  }

  if (property.valueType === 'NUMBER' && typeof value === 'number') {
    return formatNumber(value);
  }

  let formattedValue = value.toString();

  // Filter out "macro|" prefix for system owner properties
  if (property.displayName === 'Owner') {
    formattedValue = formattedValue.replace('macro|', '');
  }

  return formattedValue;
};

/**
 * Format a property option value by looking up its UUID in the options list
 * Used when you have an option ID and need to display its value
 *
 * @param optionId - The UUID of the option
 * @param options - The property's options array (from property.options)
 * @returns Formatted display value or the ID if not found
 */
export const formatOptionValueById = (
  optionId: string,
  options: Array<{ id: string; value: PropertyOptionValue }> | undefined
): string => {
  if (!options) return optionId;

  const option = options.find((opt) => opt.id === optionId);
  if (!option) return optionId; // Fallback to showing the ID if option not found

  return formatOptionValue(option);
};

/**
 * Format a property option value for display (used when you already have the option object)
 * Takes a PropertyOption object and extracts its display value
 */
export const formatOptionValue = (option: {
  value: PropertyOptionValue;
}): string => {
  const optionValue = option.value;
  if ('type' in optionValue && 'value' in optionValue) {
    if (optionValue.type === 'string') {
      return optionValue.value;
    }
    if (optionValue.type === 'number') {
      return optionValue.value.toString();
    }
  }
  return 'No value';
};

/**
 * Get the raw option value (for comparison/selection)
 * Takes a PropertyOption object and extracts its raw value
 */
export const getOptionValue = (option: {
  value: PropertyOptionValue;
}): string => {
  const optionValue = option.value;
  if ('type' in optionValue && 'value' in optionValue) {
    if (optionValue.type === 'string') {
      return optionValue.value;
    }
    if (optionValue.type === 'number') {
      return optionValue.value.toString();
    }
  }
  return '';
};

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
  data_type: string;
  specific_entity_type?: string | null;
  is_multi_select: boolean;
}): string => {
  if (!property) {
    return 'Unknown';
  }

  const { data_type, specific_entity_type, is_multi_select } = property;

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
    display = `${is_multi_select === true ? 'Multi' : 'Single'} ${display}`;
  } else if (dataTypeLower === 'entity') {
    display = `${is_multi_select === true ? 'Multi' : 'Single'}-Select ${display}`;
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

/**
 * Consolidated hook for auto-focusing elements with reliable focus handling.
 * Handles race conditions with API responses, modal loading, and DOM updates.
 */
export function useAutoFocus(
  inputRef: () => HTMLElement | undefined,
  shouldFocus: () => boolean = () => true,
  options: {
    delay?: number;
    maxAttempts?: number;
  } = {}
) {
  const {
    delay = FOCUS_CONFIG.DEFAULT_DELAY,
    maxAttempts = FOCUS_CONFIG.MAX_ATTEMPTS,
  } = options;

  const focusElement = (
    element: HTMLElement | undefined,
    attempts = maxAttempts
  ) => {
    if (!element || attempts <= 0) return;

    requestAnimationFrame(() => {
      if (
        element.offsetParent !== null &&
        !('disabled' in element && element.disabled) &&
        element.tabIndex >= 0
      ) {
        try {
          element.focus();
          if (document.activeElement === element) {
            return;
          }
        } catch (_error) {
          // Focus failed, will retry
        }
      }

      setTimeout(() => {
        focusElement(element, attempts - 1);
      }, FOCUS_CONFIG.RETRY_DELAY);
    });
  };

  createEffect(() => {
    if (shouldFocus()) {
      const timeoutId = setTimeout(() => {
        focusElement(inputRef());
      }, delay);

      onCleanup(() => {
        clearTimeout(timeoutId);
      });
    }
  });

  return { focusElement };
}

export function useSearchInputFocus(
  inputRef: () => HTMLInputElement | undefined,
  shouldFocus: () => boolean = () => true
) {
  return useAutoFocus(inputRef, shouldFocus, {
    delay: FOCUS_CONFIG.DEFAULT_DELAY,
  });
}

export function usePropertyNameFocus(
  inputRef: () => HTMLInputElement | undefined,
  isCreating: () => boolean
) {
  return useAutoFocus(inputRef, isCreating, {
    delay: FOCUS_CONFIG.PROPERTY_NAME_DELAY,
  });
}
