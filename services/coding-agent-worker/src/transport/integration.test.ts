// End-to-end through the composed stack (WebSocket → CarrierConnection →
// RuntimeServiceLink) against an in-process ws server speaking the carrier
// dialect. Wire-level concerns only — per-layer behavior lives in the unit
// suites (carrier.test.ts, link.test.ts).

import { afterEach, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import type { Inbound, ServiceLink } from '../protocol/port'
import { connectServiceLink } from './link'

const SUBSCRIPTION_ID = 7841

type CarrierCall = { id: number; method: string; params: Record<string, unknown> }

/** In-process stand-in for the Rust service's ServerTransport. */
function fakeService() {
  const calls: CarrierCall[] = []
  const waiters: Array<(c: CarrierCall) => void> = []
  let sock: ServerWebSocket<unknown> | null = null

  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('ws only', { status: 426 })),
    websocket: {
      open(ws) {
        sock = ws
      },
      message(ws, data) {
        const call = JSON.parse(String(data)) as CarrierCall
        calls.push(call)
        waiters.shift()?.(call)
        if (call.method === 'subscribe') ws.send(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: SUBSCRIPTION_ID }))
        else if (call.method === 'send') ws.send(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: null }))
        else if (call.method === 'unsubscribe') ws.send(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: true }))
      },
    },
  })

  return {
    url: `ws://localhost:${server.port}`,
    nextCall: () =>
      new Promise<CarrierCall>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for carrier call')), 1000)
        waiters.push((c) => {
          clearTimeout(timer)
          resolve(c)
        })
      }),
    /** Push one logical message down the subscription, as the service would. */
    push(logical: unknown) {
      sock!.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'message',
          params: { subscription: SUBSCRIPTION_ID, result: { message: logical } },
        }),
      )
    },
    stop: () => server.stop(true),
  }
}

async function nextInbound(link: ServiceLink): Promise<Inbound> {
  for await (const msg of link.inbound) return msg
  throw new Error('link.inbound ended before a message arrived')
}

let cleanup: Array<() => unknown> = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function setup() {
  const service = fakeService()
  cleanup.push(service.stop)
  const subscribed = service.nextCall()
  const link = await connectServiceLink(service.url)
  cleanup.push(() => link.close())
  return { service, link, subscribe: await subscribed }
}

test('handshake + runtime/ready arrive send-wrapped on the real wire', async () => {
  const { service, link, subscribe } = await setup()
  expect(subscribe.method).toBe('subscribe')
  expect(subscribe.params.connectionId).toMatch(/^[0-9a-f-]{36}$/)

  const next = service.nextCall()
  link.event('runtime/ready')
  const call = await next
  expect(call.method).toBe('send')
  expect(call.params.connectionId).toBe(subscribe.params.connectionId)
  const message = call.params.message as { method: string; params: Record<string, unknown> }
  expect(message.method).toBe('system_event')
  expect(message.params).toMatchObject({ name: 'runtime/ready', sequence: 1 })
})

test('command → respond() round-trip rides the nested id', async () => {
  const { service, link } = await setup()
  service.push({ jsonrpc: '2.0', id: 3, method: 'command', params: { commandId: 'cmd-1', name: 'runtime/configure' } })

  const msg = await nextInbound(link)
  if (msg.kind !== 'command') throw new Error(`expected command, got ${msg.kind}`)

  const reply = service.nextCall()
  msg.respond({ status: 'completed' })
  const nested = (await reply).params.message as Record<string, unknown>
  expect(nested).toMatchObject({ jsonrpc: '2.0', id: 3, result: { status: 'completed' } })
})

test('acp flows both directions', async () => {
  const { service, link } = await setup()
  const frame = { jsonrpc: '2.0', id: 'sys:1', method: 'initialize', params: { protocolVersion: 1 } }
  service.push({
    jsonrpc: '2.0',
    method: 'acp',
    params: { messageId: 'acp-1', agentId: 'a', agentInstanceId: 'i1', message: frame },
  })
  expect(await nextInbound(link)).toEqual({ kind: 'acp', target: { agentId: 'a', agentInstanceId: 'i1' }, frame })

  const next = service.nextCall()
  link.acp({ agentId: 'a', agentInstanceId: 'i1' }, { jsonrpc: '2.0', method: 'session/prompt', params: {} })
  const sent = (await next).params.message as { method: string; params: Record<string, unknown> }
  expect(sent.method).toBe('acp')
  expect(sent.params).toMatchObject({
    agentId: 'a',
    agentInstanceId: 'i1',
    message: { jsonrpc: '2.0', method: 'session/prompt', params: {} },
  })
})
