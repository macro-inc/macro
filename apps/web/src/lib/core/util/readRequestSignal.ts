import { getNativeNetworkAbortSignal } from '@core/mobile/native-network-status';

/** Maximum time a read the user is waiting on may wait for its response. */
export const READ_REQUEST_TIMEOUT_MS = 12_000;

/**
 * Combines a caller's cancellation with the native offline abort and a hard
 * deadline. Native HTTP requests have no default timeout and can otherwise
 * remain pending indefinitely when connectivity disappears mid-request.
 */
export function createReadRequestSignal(
  signal?: AbortSignal,
  timeoutMs = READ_REQUEST_TIMEOUT_MS
): AbortSignal {
  return AbortSignal.any([
    ...(signal ? [signal] : []),
    getNativeNetworkAbortSignal(),
    AbortSignal.timeout(timeoutMs),
  ]);
}
