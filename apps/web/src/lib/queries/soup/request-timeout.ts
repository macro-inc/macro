import {
  createReadRequestSignal,
  READ_REQUEST_TIMEOUT_MS,
} from '@core/util/readRequestSignal';

/** Maximum time an active Soup view may wait for its network response. */
export const SOUP_REQUEST_TIMEOUT_MS = READ_REQUEST_TIMEOUT_MS;

/** Soup failures remain user-retryable instead of retrying in the background. */
export const SOUP_NETWORK_QUERY_OPTIONS = {
  retry: false,
} as const;

/** Combines TanStack's query-cancellation signal with the shared read deadline. */
export function createSoupRequestSignal(
  querySignal: AbortSignal,
  timeoutMs = SOUP_REQUEST_TIMEOUT_MS
): AbortSignal {
  return createReadRequestSignal(querySignal, timeoutMs);
}
