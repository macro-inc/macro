import { ThrownResultError } from '@core/util/result';

const RETRYABLE_WEBSOCKET_CLOSE_CODES = new Set([
  1000, // the server closed normally while subscriptions were still active
  1001, // endpoint is temporarily going away
  1005, // no close status received
  1006, // abnormal network closure
  1012, // service restart
  1013, // try again later
  1014, // bad gateway
  4408, // connection initialisation timeout
  4504, // connection acknowledgement timeout
  4499, // a frozen socket was terminated by the heartbeat watchdog
]);

/** Retry transient transport failures, but not auth or protocol failures. */
export function shouldRetryGraphqlSoupWebSocket(error: unknown): boolean {
  const errors = error instanceof ThrownResultError ? error.errors : error;
  if (Array.isArray(errors)) {
    return (
      errors.length > 0 &&
      errors.every(
        (item: unknown) =>
          item !== null &&
          typeof item === 'object' &&
          'code' in item &&
          typeof item.code === 'string' &&
          ['NETWORK_ERROR', 'SERVER_ERROR', 'HTTP_ERROR'].includes(item.code)
      )
    );
  }
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return (
      typeof code === 'number' && RETRYABLE_WEBSOCKET_CLOSE_CODES.has(code)
    );
  }

  // Browser websocket network failures arrive as Events. Errors thrown while
  // resolving auth or processing the protocol are not retryable.
  return typeof Event !== 'undefined' && error instanceof Event;
}
