import { CombinedError } from '@urql/core';
import { ThrownResultError } from './result';

/**
 * A known transport failure with no server response. Cached reads may stay
 * visible for these failures; HTTP, GraphQL and unknown application errors
 * must still surface. This is deliberately narrower than retry eligibility.
 */
export function isResponseFreeNetworkError(error: unknown): boolean {
  if (error instanceof CombinedError) {
    return (
      !error.response &&
      error.graphQLErrors.length === 0 &&
      error.networkError != null
    );
  }
  if (error instanceof ThrownResultError) {
    return (
      error.errors.length > 0 &&
      error.errors.every(({ code }) => code === 'NETWORK_ERROR')
    );
  }
  return false;
}

/**
 * Classifies transport/server failures shared by cached reads and retries.
 * Structured application errors take precedence; untyped errors are treated as
 * transient. Callers still own cache availability and explicit retry policies.
 */
export function isTransientRequestError(
  error: Error | null | undefined
): boolean {
  if (!error) return false;
  if (error instanceof CombinedError) {
    const status = error.response?.status;
    return (
      error.graphQLErrors.length === 0 &&
      error.networkError != null &&
      (status == null || status >= 500)
    );
  }
  if (error instanceof ThrownResultError) {
    return (
      error.errors.length > 0 &&
      error.errors.every(
        ({ code }) => code === 'NETWORK_ERROR' || code === 'SERVER_ERROR'
      )
    );
  }
  return true;
}
