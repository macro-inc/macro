// The client of our system, speaking our envelope protocol. It plays the
// upstream role: a tiny ws SERVER the worker dials (UPSTREAM_WS_URL). Prints
// system status + the tunneled ACP stream, and lets you type messages that
// get tunneled back to the agent as session/prompt turns.
//
//   bun scripts/client.ts [--raw]     # listens on :4001 (UPSTREAM_PORT to change)
//
// Then in another shell: just serve, and POST /session — the worker connects
// here and the whole session streams into this terminal.

import readline from 'node:readline'
import type { NewSessionResponse, PromptRequest, SessionNotification } from '@zed-industries/agent-client-protocol'
import chalk from 'chalk'
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0'
import { match } from 'ts-pattern'
import type { ServerWebSocket } from 'bun'
import { Method, StatusParams } from '../shared/envelope'
import { makeRenderer } from './render'

const port = Number(process.env.UPSTREAM_PORT ?? 4001)
const raw = process.argv.includes('--raw')
const render = makeRenderer()

// ACP methods our side originates — mirrored frames, not agent output.
const CLIENT_METHODS = new Set(['initialize', 'session/new', 'session/prompt'])

let sock: ServerWebSocket<unknown> | null = null
let acpSessionId: string | null = null
let nextId = 1

// A tunneled ACP frame is a JSON-RPC envelope; we only peek at a few fields,
// typed with the shapes ACP actually puts there.
type AcpFrame = {
  id?: string | number
  method?: string
  params?: SessionNotification
  result?: NewSessionResponse
}

function handleAcp(frame: AcpFrame) {
  // Learn the ACP session id from the session/new response as it flies past.
  if (frame.result?.sessionId) acpSessionId = frame.result.sessionId

  if (raw) return // already printed verbatim
  match(frame)
    .with({ method: 'session/update' }, (m) => {
      if (m.params) render(m.params.update)
    })
    .when(
      (m) => !!m.method && CLIENT_METHODS.has(m.method),
      (m) => console.error(chalk.dim(`→ ${m.method}${m.id != null ? ` (${m.id})` : ''}`)),
    )
    .when(
      (m) => !!m.method && m.id != null,
      // Agent→client request (e.g. permission) that nobody is answering.
      (m) => console.error(chalk.yellow(`⚠ agent request left unanswered: ${m.method} (id ${m.id})`)),
    )
    .otherwise(() => {}) // responses and other notifications: quiet in pretty mode
}

const rpc = new JSONRPCServerAndClient(
  new JSONRPCServer(),
  new JSONRPCClient((payload) => {
    sock?.send(JSON.stringify(payload))
  }),
)

rpc.addMethod(Method.Status, (params) => {
  const { status } = StatusParams.parse(params)
  if (!raw) console.error(chalk.magenta(`[status] ${status}`))
})

rpc.addMethod(Method.Acp, (frame) => handleAcp(frame as AcpFrame))

Bun.serve({
  port,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined
    return new Response('mock upstream: websocket only', { status: 426 })
  },
  websocket: {
    open(ws) {
      sock = ws
      console.error(chalk.dim('[upstream] worker connected'))
    },
    message(_ws, data) {
      const text = String(data)
      if (raw) console.log(text)
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return
      }
      void rpc.receiveAndSend(payload).catch(() => console.error('[upstream] ignoring invalid worker message'))
    },
    close() {
      sock = null
      console.error(chalk.dim('[upstream] worker disconnected'))
    },
  },
})
console.error(chalk.dim(`[upstream] listening on ws://localhost:${port} — waiting for the worker to dial in`))

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  if (!sock) return console.error(chalk.red('[upstream] no worker connected'))
  if (!acpSessionId) return console.error(chalk.red('[upstream] no ACP session yet'))
  const params: PromptRequest = { sessionId: acpSessionId, prompt: [{ type: 'text', text }] }
  rpc.notify(Method.Acp, { jsonrpc: '2.0', id: `up:${nextId++}`, method: 'session/prompt', params })
})
