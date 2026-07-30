import { describe, expect, test } from 'bun:test'
import { isJsonRpcMessage } from './jsonrpc'

describe('isJsonRpcMessage', () => {
  test('accepts requests, notifications and responses', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toBe(true)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 'a', method: 'session/new' })).toBe(true)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: null, method: 'x' })).toBe(true)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'session/update' })).toBe(true)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true)
  })

  test('passes through methods it has never heard of', () => {
    // agent_proxy relays verbatim; an unrecognised method must not be dropped.
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'vendor/whatever' })).toBe(true)
  })

  test('rejects anything that is not a JSON-RPC envelope', () => {
    expect(isJsonRpcMessage(null)).toBe(false)
    expect(isJsonRpcMessage('string')).toBe(false)
    expect(isJsonRpcMessage(42)).toBe(false)
    expect(isJsonRpcMessage([])).toBe(false)
    expect(isJsonRpcMessage({ id: 1, method: 'initialize' })).toBe(false)
    expect(isJsonRpcMessage({ jsonrpc: '1.0', id: 1, method: 'initialize' })).toBe(false)
  })

  test('rejects malformed ids and responses', () => {
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: {}, method: 'x' })).toBe(false)
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: Number.NaN, method: 'x' })).toBe(false)
    // no method and no result/error at all
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1 })).toBe(false)
    // both result and error
    expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: {}, error: {} })).toBe(false)
  })
})
