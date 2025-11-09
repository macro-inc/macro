export interface ErrorResult {
  ok: false;
  error: string;
}

export interface SuccessResult<T = undefined> {
  ok: true;
  value: T;
}

export type ApiResult<T = undefined> = SuccessResult<T> | ErrorResult;

/**
 * Standardized error handling for API operations
 * Provides consistent error logging and return values
 * Note: Toast notifications should be handled at the component level
 */
export class ErrorHandler {
  /**
   * Handle API errors with consistent logging
   */
  static handleApiError(
    error: unknown,
    context: string,
    userMessage?: string
  ): ErrorResult {
    const errorMessage = userMessage || 'An unexpected error occurred';

    // Log the full error for debugging
    console.error(`${context}:`, error);

    return {
      ok: false,
      error: errorMessage,
    };
  }

  /**
   * Handle successful API operations
   */
  static handleSuccess<T>(value: T): SuccessResult<T> {
    return {
      ok: true,
      value,
    };
  }

  /**
   * Handle API operations with automatic error handling
   */
  static async handleApiCall<T>(
    apiCall: () => Promise<T>,
    context: string,
    userMessage?: string
  ): Promise<ApiResult<T>> {
    try {
      const result = await apiCall();
      return this.handleSuccess(result);
    } catch (error) {
      return this.handleApiError(error, context, userMessage);
    }
  }

  /**
   * Handle validation errors (no API call needed)
   */
  static handleValidationError(message: string): ErrorResult {
    return {
      ok: false,
      error: message,
    };
  }
}

/**
 * Common error messages for consistency
 */
export const ERROR_MESSAGES = {
  FETCH_PROPERTIES: 'Failed to load properties',
  SAVE_PROPERTY: 'Failed to save property value',
  DELETE_PROPERTY: 'Failed to delete property',
  ADD_PROPERTY: 'Failed to add property',
  CREATE_PROPERTY: 'Failed to create property',
  FETCH_OPTIONS: 'Failed to load property options',
  ADD_OPTION: 'Failed to add option',
  VALIDATION_REQUIRED: 'This field is required',
  VALIDATION_DUPLICATE: 'Duplicate values are not allowed',
  VALIDATION_MIN_OPTIONS: 'Must have at least one option',
} as const;
