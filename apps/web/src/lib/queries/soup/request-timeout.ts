import { getNativeNetworkAbortSignal } from '@core/mobile/native-network-status';

/** Maximum time an active Soup view may wait for its network response. */
export const SOUP_REQUEST_TIMEOUT_MS = 12_000;

/** Soup failures remain user-retryable instead of retrying in the background. */
export const SOUP_NETWORK_QUERY_OPTIONS = {
  retry: false,
} as const;

/**
 * Combines TanStack's query-cancellation signal with a hard request deadline.
 * Native HTTP requests can otherwise remain pending indefinitely when
 * connectivity disappears after the app has started.
 */
export function createSoupRequestSignal(
  querySignal: AbortSignal,
  timeoutMs = SOUP_REQUEST_TIMEOUT_MS
): AbortSignal {
  return AbortSignal.any([
    querySignal,
    getNativeNetworkAbortSignal(),
    AbortSignal.timeout(timeoutMs),
  ]);
}
