// CarrierConnection unit tests against a mock Duplex<unknown> — no sockets,
// no JSON strings. Wire shapes mirror
// crates/agent_runtime_protocol/src/transport/jsonrpsee/test.rs.

import { expect, test } from 'bun:test'
import { CarrierConnection } from './carrier'
import { collector, mockDuplex } from './testing'

const SUBSCRIPTION_ID = 7841

/** Drive the subscribe handshake against the mock and return both halves. */
async function connect() {
  const peer = mockDuplex()
  const connecting = CarrierConnection.connect(peer.duplex)
  const subscribe = await peer.nextSent()
  peer.receive({ jsonrpc: '2.0', id: subscribe.id, result: SUBSCRIPTION_ID })
  return { peer, carrier: await connecting, subscribe }
}

/** Collect what the carrier surfaces as logical messages. */
function logicalOf(carrier: CarrierConnection) {
  const logical = collector<unknown>()
  carrier.onItem((message) => logical.collect(message))
  return logical
}

test('connect() sends subscribe with a fresh connectionId and awaits acceptance', async () => {
  const { subscribe, carrier } = await connect()
  expect(subscribe).toMatchObject({ jsonrpc: '2.0', method: 'subscribe' })
  expect(subscribe.params.connectionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(carrier.connectionId).toBe(subscribe.params.connectionId)
})

test('send() wraps the logical message with the connectionId', async () => {
  const { peer, carrier } = await connect()
  carrier.send({ jsonrpc: '2.0', method: 'system_event', params: { name: 'runtime/ready' } })
  const frame = await peer.nextSent()
  expect(frame.method).toBe('send')
  expect(frame.params).toEqual({
    connectionId: carrier.connectionId,
    message: { jsonrpc: '2.0', method: 'system_event', params: { name: 'runtime/ready' } },
  })
})

test('carrier rejections (-32004) are swallowed, not thrown', async () => {
  const { peer, carrier } = await connect()
  carrier.send({ jsonrpc: '2.0', method: 'system_event', params: {} })
  const frame = await peer.nextSent()
  peer.receive({ jsonrpc: '2.0', id: frame.id, error: { code: -32004, message: 'connection not found' } })
  // Nothing to await — the rejection is caught internally; reaching here
  // without an unhandled rejection is the assertion.
  await Bun.sleep(10)
})

test('subscription items for our subscription surface as logical messages', async () => {
  const { peer, carrier } = await connect()
  const logical = logicalOf(carrier)
  peer.receive({
    jsonrpc: '2.0',
    method: 'message',
    params: { subscription: SUBSCRIPTION_ID, result: { message: { jsonrpc: '2.0', method: 'acp', params: {} } } },
  })
  expect(await logical.next()).toEqual({ jsonrpc: '2.0', method: 'acp', params: {} })
})

test('items for another subscription are dropped', async () => {
  const { peer, carrier } = await connect()
  const logical = logicalOf(carrier)
  peer.receive({
    jsonrpc: '2.0',
    method: 'message',
    params: { subscription: 999, result: { message: { stray: true } } },
  })
  peer.receive({
    jsonrpc: '2.0',
    method: 'message',
    params: { subscription: SUBSCRIPTION_ID, result: { message: { mine: true } } },
  })
  expect(await logical.next()).toEqual({ mine: true })
})

test('close() unsubscribes with the subscription id, then closes the pipe; idempotent', async () => {
  const { peer, carrier } = await connect()
  const closing = carrier.close()
  const frame = await peer.nextSent()
  expect(frame.method).toBe('unsubscribe')
  expect(frame.params).toEqual([SUBSCRIPTION_ID])
  peer.receive({ jsonrpc: '2.0', id: frame.id, result: true })
  await closing
  expect(peer.wasClosed()).toBe(true)
  await carrier.close() // second close must not hang on the dead pipe
})

test('peer dropping the pipe fires onClose', async () => {
  const { peer, carrier } = await connect()
  let closedSeen = false
  carrier.onClose(() => {
    closedSeen = true
  })
  peer.end()
  expect(closedSeen).toBe(true)
})

test('close() after the peer dropped the pipe resolves without hanging', async () => {
  const { peer, carrier } = await connect()
  peer.end()
  const framesBefore = peer.sent.length
  await carrier.close()
  expect(peer.sent.length).toBe(framesBefore) // no unsubscribe attempted on a dead pipe
})
