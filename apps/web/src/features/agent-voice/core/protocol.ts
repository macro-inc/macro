import type { AgentCancel, AgentRequest } from './types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const encoder = new TextEncoder();
export const VOICE_PAYLOAD_BYTES = 15_000;

/** Bound text including JSON escapes, without splitting a Unicode code point. */
export function boundedText(text: string, maxBytes: number): string {
  if (encoder.encode(JSON.stringify(text)).byteLength - 2 <= maxBytes)
    return text;
  let bytes = 0;
  let length = 0;
  for (const character of text) {
    bytes += encoder.encode(JSON.stringify(character)).byteLength - 2;
    if (bytes > maxBytes) break;
    length += character.length;
  }
  return text.slice(0, length);
}

export function serializeVoicePayload(value: unknown): string {
  const payload = JSON.stringify(value);
  if (encoder.encode(payload).byteLength > VOICE_PAYLOAD_BYTES)
    throw new Error(
      'Voice message is too large. Please use a shorter request.'
    );
  return payload;
}

function parsePayload(payload: string): unknown {
  if (encoder.encode(payload).byteLength > VOICE_PAYLOAD_BYTES)
    throw new Error('Voice message is too large.');
  return JSON.parse(payload);
}
export function parseAgentRequest(payload: string): AgentRequest {
  const value = parsePayload(payload);
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.requestId !== 'string' ||
    !UUID.test(value.requestId) ||
    typeof value.prompt !== 'string' ||
    !value.prompt.trim() ||
    value.prompt.length > 24_000
  )
    throw new Error('Invalid agent request.');
  return {
    version: 1,
    requestId: value.requestId,
    prompt: value.prompt.trim(),
  };
}
export function parseAgentCancel(payload: string): AgentCancel {
  const value = parsePayload(payload);
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.requestId !== 'string' ||
    !UUID.test(value.requestId) ||
    typeof value.taskId !== 'string' ||
    !UUID.test(value.taskId) ||
    (value.replacementPrompt !== undefined &&
      (typeof value.replacementPrompt !== 'string' ||
        !value.replacementPrompt.trim() ||
        value.replacementPrompt.length > 24_000))
  )
    throw new Error('Invalid cancellation request.');
  return {
    version: 1,
    requestId: value.requestId,
    taskId: value.taskId,
    ...(typeof value.replacementPrompt === 'string'
      ? { replacementPrompt: value.replacementPrompt.trim() }
      : {}),
  };
}
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
