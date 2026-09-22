const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const VOICE_PAYLOAD_BYTES = 15_000;

export function parseWorkerEvent(
  payload: Uint8Array
): { type: 'ready' | 'error' | 'ended'; message?: string } | undefined {
  try {
    if (payload.byteLength > VOICE_PAYLOAD_BYTES) return;
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (
      !record(value) ||
      value.version !== 1 ||
      (value.type !== 'ready' &&
        value.type !== 'error' &&
        value.type !== 'ended')
    )
      return;
    return {
      type: value.type,
      ...(typeof value.message === 'string'
        ? { message: value.message.slice(0, 500) }
        : {}),
    };
  } catch {
    return;
  }
}
