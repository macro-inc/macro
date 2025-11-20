import { NUMBER_DECIMAL_PLACES } from '../constants';
import type { Property, PropertyOptionValue } from '../types';

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
 * Format a property value for display
 * Handles all value types including looking up select options by ID
 * Returns '—' for undefined/null values
 */
export const formatPropertyValue = (
  property: Property,
  value: PropertyValueUnion | string | null | undefined
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
