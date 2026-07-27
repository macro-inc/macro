import { expect, test } from 'bun:test'
import { UpstreamLink } from './upstream'

class MockWebSocket extends EventTarget {
  readonly sent: string[] = []

  send(message: string) {
    this.sent.push(message)
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  receive(message: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

function setup() {
  const sockets: MockWebSocket[] = []
  const urls: string[] = []
  const link = new UpstreamLink(
    'ws://localhost:4001/ws?existing=true',
    'session 1',
    (url) => {
      urls.push(url)
      const socket = new MockWebSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    0,
  )
  return { link, sockets, urls }
}

test('uses the query session id and agent_runtime_protocol tagged messages', () => {
  const { link, sockets, urls } = setup()
  expect(new URL(urls[0]!).searchParams.get('id')).toBe('session 1')
  expect(new URL(urls[0]!).searchParams.get('existing')).toBe('true')

  link.status('booting')
  sockets[0]!.open()
  expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'event', event: 'booting' })

  link.acp({ jsonrpc: '2.0', method: 'session/update' })
  expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({
    type: 'acp',
    jsonrpc: '2.0',
    method: 'session/update',
  })

  let received: unknown
  link.onAcp = (message) => {
    received = message
  }
  sockets[0]!.receive({ type: 'acp', jsonrpc: '2.0', id: 1, result: {} })
  expect(received).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
  link.close()
})

test('reconnect sends current event and only ACP queued while offline', async () => {
  const { link, sockets } = setup()
  link.status('ready')
  sockets[0]!.open()
  link.acp({ jsonrpc: '2.0', id: 'already-sent', method: 'session/prompt' })
  sockets[0]!.close()
  link.acp({ jsonrpc: '2.0', id: 'queued', method: 'session/prompt' })

  await Bun.sleep(1)
  sockets[1]!.open()
  expect(sockets[1]!.sent.map((message) => JSON.parse(message))).toEqual([
    { type: 'event', event: 'ready' },
    { type: 'acp', jsonrpc: '2.0', id: 'queued', method: 'session/prompt' },
  ])
  link.close()
})
