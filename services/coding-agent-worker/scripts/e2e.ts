// End-to-end check of the webhook flow in ONE foreground process:
// an in-process mock upstream ws server + a real Daytona session driven by
// startSession(). Asserts the system/status lifecycle and that ACP frames
// flowed, then sends a tunneled follow-up prompt and waits for its turn to
// complete. Usage: GITHUB_TOKEN=... bun scripts/e2e.ts

import type { PromptRequest } from '@zed-industries/agent-client-protocol'
import type { ServerWebSocket } from 'bun'
import { createJSONRPCNotification } from 'json-rpc-2.0'

const PORT = 4901
process.env.UPSTREAM_WS_URL = `ws://localhost:${PORT}`

const states: string[] = []
let acpFrames = 0
let acpSessionId: string | null = null
let messageText = ''
let kickoffDone = false
let sock: ServerWebSocket<unknown> | null = null
const done = Promise.withResolvers<void>()

// The kickoff turn's completion is a relayed ACP response carrying a stopReason.
function sendFollowUp() {
  console.error('[e2e] sending tunneled follow-up prompt...')
  const params: PromptRequest = {
    sessionId: acpSessionId ?? '',
    prompt: [{ type: 'text', text: 'reply with exactly: follow-up ok' }],
  }
  sock?.send(
    JSON.stringify(createJSONRPCNotification('acp', { jsonrpc: '2.0', id: 'up:1', method: 'session/prompt', params })),
  )
}

Bun.serve({
  port: PORT,
  fetch(req, server) {
    return server.upgrade(req) ? undefined : new Response('ws only', { status: 426 })
  },
  websocket: {
    open(ws) {
      sock = ws
      console.error('[e2e] worker dialed in')
    },
    message(_ws, data) {
      const m = JSON.parse(String(data))
      if (m.method === 'system/status') {
        states.push(m.params.status)
        console.error(`[e2e] status: ${m.params.status}`)
      }
      if (m.method === 'acp') {
        acpFrames++
        const f = m.params
        if (f?.result?.sessionId) acpSessionId = f.result.sessionId
        if (f?.method === 'session/update' && f.params?.update?.sessionUpdate === 'agent_message_chunk')
          messageText += f.params.update.content?.text ?? ''
        // Turn completions are relayed ACP responses carrying a stopReason.
        if (f?.result?.stopReason !== undefined) {
          if (f.id === 'up:1') {
            // The follow-up we tunneled resolves outside the worker's sys: ids —
            // its response comes back to US. That's the router model working.
            console.error(`[e2e] follow-up turn completed: ${JSON.stringify(f.result)}`)
            done.resolve()
          } else if (!kickoffDone) {
            kickoffDone = true // kickoff turn done → send a tunneled follow-up prompt
            sendFollowUp()
          }
        }
      }
    },
  },
})

const { startSession, destroySession } = await import('../src/session')

const sessionId = startSession({
  repoUrl: 'https://github.com/macro-inc/macro',
  prompt: 'reply with exactly: kickoff ok',
})
console.error(`[e2e] started session ${sessionId}`)

const timeout = setTimeout(() => {
  console.error('[e2e] TIMEOUT waiting for follow-up turn')
  process.exitCode = 1
  done.resolve()
}, 360_000)

await done.promise
clearTimeout(timeout)
await destroySession(sessionId)

const expected = ['booting', 'ready']
const lifecycleOk = expected.every((s) => states.includes(s))
console.error(`\n[e2e] states: ${states.join(' → ')}`)
console.error(`[e2e] acp frames relayed: ${acpFrames}`)
console.error(`[e2e] agent said: ${messageText.slice(0, 200)}`)
if (lifecycleOk && acpFrames > 5 && process.exitCode !== 1) {
  console.error('[e2e] PASS')
  process.exit(0)
} else {
  console.error('[e2e] FAIL')
  process.exit(1)
}
