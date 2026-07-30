import type { AnyMessage } from '@agentclientprotocol/sdk'

/** Frames arrive as parsed JSON off a WebSocket, so `unknown` is their honest
 * type; the only sound way to reach `AnyMessage` is to check at runtime. The
 * ACP SDK has these guards internally but exports neither them nor a subpath
 * to reach them, so the envelope checks are mirrored here.
 *
 * Envelope shape only — no ACP method or param validation. agent_proxy relays
 * ACP traffic verbatim, so a frame carrying a method this worker has never
 * heard of must still pass through untouched. */

function isJsonRpcId(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  return (value as Record<string, unknown>).jsonrpc === '2.0'
}

/** Whether a value is a JSON-RPC request, response, or notification. */
export function isJsonRpcMessage(value: unknown): value is AnyMessage {
  if (!isEnvelope(value)) return false

  // Request: id + method. Notification: method, no id.
  if (typeof value.method === 'string') {
    return 'id' in value ? isJsonRpcId(value.id) : true
  }

  // Response: id, no method, and exactly one of result/error.
  if (!('id' in value) || !isJsonRpcId(value.id)) return false
  return Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error')
}
