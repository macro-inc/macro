/**
 * Safely reads a websocket frame's `data`. The connection gateway always sends
 * it as a JSON string (see `services/connection_gateway/src/model/message.rs`),
 * but already-parsed objects pass through unchanged so callers don't need to
 * care. Returns `undefined` — never throws — when the payload is malformed.
 */
export function parseWebsocketPayload<T>(
  type: string,
  payload: unknown
): T | undefined {
  if (typeof payload !== 'string') return payload as T;

  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    console.warn('Malformed websocket payload', { type, payload, error });
    return undefined;
  }
}
