import { render, Box, Static, Text } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useRef, useState } from 'react'
import type { PromptRequest } from '@zed-industries/agent-client-protocol'
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0'
import type { ServerWebSocket } from 'bun'
import { Method, StatusParams } from '../shared/envelope'

const port = Number(process.env.UPSTREAM_PORT ?? 4001)

function timestamp() {
  return new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
}

type AcpFrame = {
  id?: string | number
  result?: { sessionId?: string }
  method?: string
  params?: { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
}

function handleAcp(frame: AcpFrame, acpSessionId: React.MutableRefObject<string | null>) {
  if (frame.result?.sessionId) acpSessionId.current = frame.result.sessionId
}

// Color raw log lines by what kind of ACP update they carry, if any.
function colorFor(frame: AcpFrame): string | undefined {
  const kind = frame.method === 'session/update' ? frame.params?.update?.sessionUpdate : undefined
  if (kind === 'agent_message_chunk') return 'green'
  if (kind === 'agent_thought_chunk') return 'gray'
  return undefined
}

type Line = { text: string; color?: string }

function App() {
  const [lines, setLines] = useState<Line[]>([])
  const [response, setResponse] = useState('')
  const [input, setInput] = useState('')
  const sock = useRef<ServerWebSocket<unknown> | null>(null)
  const acpSessionId = useRef<string | null>(null)
  const nextId = useRef(1)
  const rpc = useRef<JSONRPCServerAndClient | null>(null)

  const log = (line: string, color?: string) => setLines((prev) => [...prev, { text: `${timestamp()} ${line}`, color }])

  useEffect(() => {
    rpc.current = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient((payload) => {
        sock.current?.send(JSON.stringify(payload))
      }),
    )
    rpc.current.addMethod(Method.Status, (params) => {
      StatusParams.parse(params)
    })
    rpc.current.addMethod(Method.Acp, (frame) => handleAcp(frame as { result?: { sessionId?: string } }, acpSessionId))

    const server = Bun.serve({
      port,
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined
        return new Response('mock upstream: websocket only', { status: 426 })
      },
      websocket: {
        open(ws) {
          sock.current = ws
          log('[upstream] worker connected')
        },
        message(_ws, data) {
          const text = String(data)
          let payload: { method?: string; params?: AcpFrame } | undefined
          try {
            payload = JSON.parse(text)
          } catch {
            log(text)
            return
          }
          const acpFrame = payload?.method === Method.Acp ? payload.params : undefined
          log(text, acpFrame && colorFor(acpFrame))

          if (acpFrame?.method === 'session/update' && acpFrame.params?.update?.sessionUpdate === 'agent_message_chunk') {
            const chunkText = acpFrame.params.update.content?.text
            if (chunkText) setResponse((prev) => prev + chunkText)
          }

          void rpc.current?.receiveAndSend(payload).catch(() => log('[upstream] ignoring invalid worker message'))
        },
        close() {
          sock.current = null
          log('[upstream] worker disconnected')
        },
      },
    })
    log(`[upstream] listening on ws://localhost:${port} — waiting for the worker to dial in`)

    return () => {
      server.stop()
    }
    // biome-ignore lint: run once on mount, this is a top-level server setup effect
  }, [])

  const submit = (text: string) => {
    setInput('')
    const trimmed = text.trim()
    if (!trimmed) return
    if (!sock.current) return log('[upstream] no worker connected')
    if (!acpSessionId.current) return log('[upstream] no ACP session yet')
    setResponse('')
    const params: PromptRequest = { sessionId: acpSessionId.current, prompt: [{ type: 'text', text: trimmed }] }
    rpc.current?.notify(Method.Acp, { jsonrpc: '2.0', id: `up:${nextId.current++}`, method: 'session/prompt', params })
  }

  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(line, i) => (
          <Text key={i} color={line.color}>
            {line.text}
          </Text>
        )}
      </Static>
      {response && (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginTop={1}>
          <Text bold color="green">
            agent
          </Text>
          <Text>{response}</Text>
        </Box>
      )}
      <Box>
        <Text>{'> '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>
    </Box>
  )
}

render(<App />)
