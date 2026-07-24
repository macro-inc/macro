// RuntimeServiceLink unit tests against a mock Duplex<unknown> playing the
// carrier — logical messages in, logical messages out, no sockets anywhere.

import { expect, test } from 'bun:test'
import type { Inbound } from '../protocol/port'
import { RuntimeServiceLink } from './link'
import { mockDuplex } from './testing'

function setup() {
  const peer = mockDuplex()
  const link = new RuntimeServiceLink(peer.duplex)
  return { peer, link }
}

async function nextInbound(link: RuntimeServiceLink): Promise<Inbound> {
  for await (const msg of link.inbound) return msg
  throw new Error('link.inbound ended before a message arrived')
}

test('event() sends a stamped system_event notification, sequence increments', async () => {
  const { peer, link } = setup()

  link.event('runtime/ready')
  const first = await peer.nextSent()
  expect(first).toMatchObject({ jsonrpc: '2.0', method: 'system_event' })
  expect(first.params).toMatchObject({ name: 'runtime/ready', sequence: 1 })
  expect(first.params.eventId).toMatch(/^[0-9a-f-]{36}$/)
  expect(Date.parse(first.params.occurredAt)).not.toBeNaN()
  expect(first.params).not.toContainKeys(['agentId', 'agentInstanceId', 'payload'])

  link.event('agent/started', { target: { agentId: 'a', agentInstanceId: 'i1' }, payload: { pid: 42 } })
  const second = await peer.nextSent()
  expect(second.params).toMatchObject({ sequence: 2, agentId: 'a', agentInstanceId: 'i1', payload: { pid: 42 } })
})

test('acp() wraps the frame with routing identity', async () => {
  const { peer, link } = setup()
  link.acp({ agentId: 'a', agentInstanceId: 'i1' }, { jsonrpc: '2.0', method: 'session/update', params: {} })
  const sent = await peer.nextSent()
  expect(sent).toMatchObject({ jsonrpc: '2.0', method: 'acp' })
  expect(sent.params).toMatchObject({
    agentId: 'a',
    agentInstanceId: 'i1',
    message: { jsonrpc: '2.0', method: 'session/update', params: {} },
  })
  expect(sent.params.messageId).toMatch(/^[0-9a-f-]{36}$/)
})

test('inbound command surfaces respond(); reply rides the nested id', async () => {
  const { peer, link } = setup()
  peer.receive({ jsonrpc: '2.0', id: 3, method: 'command', params: { commandId: 'cmd-1', name: 'runtime/configure' } })

  const msg = await nextInbound(link)
  if (msg.kind !== 'command') throw new Error(`expected command, got ${msg.kind}`)
  expect(msg.command).toMatchObject({ commandId: 'cmd-1', name: 'runtime/configure' })

  msg.respond({ status: 'completed' })
  expect(await peer.nextSent()).toMatchObject({ jsonrpc: '2.0', id: 3, result: { status: 'completed' } })
})

test('fail() replies with a nested JSON-RPC error on the same id', async () => {
  const { peer, link } = setup()
  peer.receive({ jsonrpc: '2.0', id: 4, method: 'command', params: { commandId: 'cmd-2', name: 'runtime/configure' } })

  const msg = await nextInbound(link)
  if (msg.kind !== 'command') throw new Error(`expected command, got ${msg.kind}`)
  msg.fail('configure rejected: no capacity')

  const reply = await peer.nextSent()
  expect(reply.id).toBe(4)
  expect(reply.error.code).toBe(-32603)
  expect(reply.error.message).toContain('no capacity')
})

test('malformed or unknown-name commands are answered with -32602 without reaching the loop', async () => {
  const { peer, link } = setup()
  peer.receive({ jsonrpc: '2.0', id: 5, method: 'command', params: { nope: true } })
  const malformed = await peer.nextSent()
  expect(malformed.id).toBe(5)
  expect(malformed.error.code).toBe(-32602)

  // Closed CommandName enum: names we don't know are invalid params too.
  peer.receive({ jsonrpc: '2.0', id: 6, method: 'command', params: { commandId: 'cmd-3', name: 'runtime/selfdestruct' } })
  const unknown = await peer.nextSent()
  expect(unknown.id).toBe(6)
  expect(unknown.error.code).toBe(-32602)
  void link // inbound intentionally untouched: nothing should have been delivered
})

test('inbound acp is unwrapped into target + verbatim frame', async () => {
  const { peer, link } = setup()
  const frame = { jsonrpc: '2.0', id: 'sys:1', method: 'initialize', params: { protocolVersion: 1 } }
  peer.receive({
    jsonrpc: '2.0',
    method: 'acp',
    params: { messageId: 'acp-1', agentId: 'a', agentInstanceId: 'i1', message: frame },
  })
  expect(await nextInbound(link)).toEqual({
    kind: 'acp',
    target: { agentId: 'a', agentInstanceId: 'i1' },
    frame,
  })
})

test('malformed logical messages are ignored, link stays usable', async () => {
  const { peer, link } = setup()
  peer.receive({ jsonrpc: '2.0', method: 'acp', params: { nope: true } }) // fails AcpMessage schema
  peer.receive({ jsonrpc: '2.0', method: 'system_event', params: {} }) // never flows service → runtime
  peer.receive({
    jsonrpc: '2.0',
    method: 'acp',
    params: { messageId: 'acp-2', agentId: 'a', agentInstanceId: 'i1', message: { jsonrpc: '2.0' } },
  })
  const msg = await nextInbound(link) // only the valid one comes through
  if (msg.kind !== 'acp') throw new Error(`expected acp, got ${msg.kind}`)
  expect(msg.target.agentInstanceId).toBe('i1')
})

test('carrier ending ends inbound; close() closes the carrier', async () => {
  const { peer, link } = setup()
  peer.end()
  const iterator = link.inbound[Symbol.asyncIterator]()
  expect((await iterator.next()).done).toBe(true)

  const other = setup()
  await other.link.close()
  expect(other.peer.wasClosed()).toBe(true)
})
