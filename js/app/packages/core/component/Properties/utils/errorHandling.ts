import { toast } from '@core/component/Toast/Toast';
import type { Result } from '../types';

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

/**
 * Handles property operation errors consistently
 * - Logs error to console
 * - Shows toast notification to user
 * - Returns boolean indicating success/failure
 *
 * @param result - Result from property operation
 * @param errorMessage - User-friendly error message
 * @param context - Context for error logging (e.g., function name)
 * @returns true if operation succeeded, false otherwise
 */
export function handlePropertyError(
  result: Result<unknown>,
  errorMessage: string,
  context: string
): boolean {
  if (result.ok) {
    return true;
  }

  console.error(`${context}:`, result.error, errorMessage);
  toast.failure(errorMessage);
  return false;
}
