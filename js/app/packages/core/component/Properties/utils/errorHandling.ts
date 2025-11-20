/**
 * Common error messages for consistency
 * Organized by category: properties, options, validation
 */
export const ERROR_MESSAGES = {
  // Property operations
  PROPERTY_FETCH: 'Unable to load properties',
  PROPERTY_SAVE: 'Unable to save property',
  PROPERTY_DELETE: 'Unable to delete property',
  PROPERTY_ADD: 'Unable to add property',
  PROPERTY_CREATE: 'Unable to create property',

  // Option operations
  OPTION_FETCH: 'Unable to load options',
  OPTION_ADD: 'Unable to add option',
  OPTION_CREATE: 'Unable to create option',

  // Validation
  VALIDATION_REQUIRED: 'This field is required',
  VALIDATION_DUPLICATE: 'Duplicate values not allowed',
  VALIDATION_MIN_OPTIONS: 'At least one option required',
} as const;
