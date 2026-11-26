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

const ACCESS_ERROR_CODES = ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'GONE'];

/**
 * The server refused the caller: HTTP 401 or 403, or an error coded as an
 * access failure. A GraphQL error without such a code is a failure to answer,
 * not a refusal.
 */
export function isAccessRequestError(error: Error): boolean {
  if (error instanceof CombinedError) {
    const status = error.response?.status;
    return (
      status === 401 ||
      status === 403 ||
      error.graphQLErrors.some(({ extensions }) =>
        ACCESS_ERROR_CODES.includes(String(extensions.code))
      )
    );
  }
  if (error instanceof ThrownResultError) {
    return error.errors.some(({ code }) => ACCESS_ERROR_CODES.includes(code));
  }
  return false;
}

/**
 * A GraphQL response whose errors are all uncoded or `INTERNAL*`: usually a
 * resolver failure (a storage outage, a dropped connection) that a later read
 * can get past. The server codes refusals; some input errors are uncoded too,
 * so a caller that retries on this must back off.
 */
export function isGraphqlServerFault(error: Error): boolean {
  if (!(error instanceof CombinedError)) return false;

  // A 4xx response is the server refusing the request, whatever its errors say.
  const status = error.response?.status;
  if (status != null && status >= 400 && status < 500) return false;

  return (
    error.graphQLErrors.length > 0 &&
    error.graphQLErrors.every(({ extensions }) => {
      const code = extensions.code;
      return code == null || String(code).startsWith('INTERNAL');
    })
  );
}
