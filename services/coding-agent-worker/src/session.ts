import { randomUUID } from 'node:crypto'
import type {
  InitializeRequest,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
} from '@zed-industries/agent-client-protocol'
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0'
import { env } from './env'
import { DaytonaProvider } from './providers/daytona'
import type { AcpConnection, AgentSandbox } from './interfaces'
import { Method, type SystemStatus } from '../shared/envelope'

const ACP_PROTOCOL_VERSION = 1

/** Outbound ws to the preconfigured upstream. Framing is delegated to a
 * json-rpc-2.0 server/client — we only send/receive notifications. Keeps a full
 * transcript; redials on drop and replays it (upstream may see duplicates on
 * reconnect — dedupe is their concern for now). */
class UpstreamLink {
  onAcp: (frame: unknown) => void = () => {}

  private ws: WebSocket | null = null
  private open = false
  private closed = false
  private readonly transcript: string[] = []
  private readonly rpc: JSONRPCServerAndClient

  constructor(private readonly url: string) {
    const server = new JSONRPCServer()
    const client = new JSONRPCClient((payload) => this.transport(payload))
    this.rpc = new JSONRPCServerAndClient(server, client)
    this.rpc.addMethod(Method.Acp, (frame) => this.onAcp(frame))
    this.dial()
  }

  /** Send an ACP frame to the upstream. */
  acp(frame: unknown) {
    this.rpc.notify(Method.Acp, frame)
  }

  /** Report a lifecycle status to the upstream. */
  status(status: SystemStatus) {
    this.rpc.notify(Method.Status, { status })
  }

  close() {
    this.closed = true
    try {
      this.ws?.close()
    } catch {}
  }

  // The json-rpc-2.0 client hands us fully-framed payloads to put on the wire.
  private transport(payload: unknown) {
    const s = JSON.stringify(payload)
    this.transcript.push(s)
    if (this.open) this.ws?.send(s) // if not open, the reconnect replay covers it
  }

  private dial() {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      this.open = true
      for (const s of this.transcript) ws.send(s)
    })
    ws.addEventListener('message', (e) => {
      let payload: unknown
      try {
        payload = JSON.parse(String(e.data))
      } catch {
        return console.error('[link] ignoring non-json upstream message')
      }
      void this.rpc.receiveAndSend(payload).catch(() => console.error('[link] ignoring invalid upstream message'))
    })
    ws.addEventListener('close', () => {
      this.open = false
      if (!this.closed) setTimeout(() => this.dial(), 1000)
    })
    ws.addEventListener('error', () => {
      try {
        ws.close()
      } catch {}
    })
  }
}

/** Boot sequencer + frame router. The worker is only the ACP client for the
 * boot sequence (initialize, session/new, kickoff prompt), using namespaced
 * string ids ("sys:N") so they can never collide with upstream's ids. All
 * frames — ours, upstream's, and every byte opencode emits — are relayed to
 * the upstream verbatim as `acp` envelope notifications. */
class SessionRouter {
  onAgentExit: () => void = () => {}

  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private readonly enc = new TextEncoder()
  private nextSysId = 1
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

  constructor(
    private readonly conn: AcpConnection,
    private readonly link: UpstreamLink,
  ) {
    this.writer = conn.writable.getWriter()
    link.onAcp = (frame) => this.writeToAgent(frame, { mirror: false }) // upstream sent it; no echo
    void this.pump()
  }

  async boot(cwd: string, prompt: string): Promise<void> {
    await this.sysRequest('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    } satisfies InitializeRequest)
    const result = (await this.sysRequest('session/new', { cwd, mcpServers: [] } satisfies NewSessionRequest)) as NewSessionResponse
    const acpSessionId = result?.sessionId
    if (!acpSessionId) throw new Error('session/new returned no sessionId')

    // Fire the kickoff prompt; its turn completes as a relayed ACP response.
    const kickoff: PromptRequest = { sessionId: acpSessionId, prompt: [{ type: 'text', text: prompt }] }
    void this.sysRequest('session/prompt', kickoff).catch(() => {})
  }

  async close(): Promise<void> {
    try {
      this.writer.releaseLock()
    } catch {}
    await this.conn.close()
  }

  private writeToAgent(frame: unknown, opts = { mirror: true }) {
    if (opts.mirror) this.link.acp(frame)
    void this.writer.write(this.enc.encode(JSON.stringify(frame) + '\n'))
  }

  private sysRequest(method: string, params: unknown): Promise<unknown> {
    const id = `sys:${this.nextSysId++}`
    const p = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.writeToAgent({ jsonrpc: '2.0', id, method, params })
    return p
  }

  private async pump(): Promise<void> {
    const reader = this.conn.readable.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let frame: { id?: unknown; result?: unknown; error?: unknown }
          try {
            frame = JSON.parse(line)
          } catch {
            continue
          }
          this.link.acp(frame)
          // Resolve our own boot requests; everything else is upstream's business.
          if (typeof frame.id === 'string' && this.pending.has(frame.id) && (frame.result !== undefined || frame.error !== undefined)) {
            const p = this.pending.get(frame.id)!
            this.pending.delete(frame.id)
            if (frame.error !== undefined) p.reject(frame.error)
            else p.resolve(frame.result)
          }
        }
      }
    } catch {
      // stream errored; treated as agent exit below
    }
    this.onAgentExit()
  }
}

type LiveSession = { sandbox: AgentSandbox; router: SessionRouter; link: UpstreamLink }
const sessions = new Map<string, LiveSession>()
const provider = new DaytonaProvider()

/** Kick off a session: returns the id immediately (webhook flow); all progress
 * streams to the upstream as system/status + tunneled acp messages. */
export function startSession(opts: { repoUrl: string; prompt: string }): string {
  const sessionId = randomUUID()
  void run(sessionId, opts)
  return sessionId
}

async function run(sessionId: string, opts: { repoUrl: string; prompt: string }): Promise<void> {
  const link = new UpstreamLink(env.UPSTREAM_WS_URL)

  let sandbox: AgentSandbox | null = null
  try {
    link.status('booting')
    sandbox = await provider.spawn({
      repoUrl: opts.repoUrl,
      envVars: {
        GITHUB_TOKEN: env.GITHUB_TOKEN,
        ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
      },
    })

    const conn = await sandbox.connect()
    const router = new SessionRouter(conn, link)
    router.onAgentExit = () => void destroySession(sessionId)
    sessions.set(sessionId, { sandbox, router, link })

    await router.boot('/workspace', opts.prompt)
    link.status('ready')
  } catch (e) {
    console.error('[session] boot failed', e)
    if (sessions.has(sessionId)) {
      await destroySession(sessionId)
    } else {
      link.status('shutting_down')
      await sandbox?.destroy().catch(() => {})
      link.close()
    }
  }
}

export async function destroySession(id: string): Promise<boolean> {
  const live = sessions.get(id)
  if (!live) return false
  sessions.delete(id)
  live.link.status('shutting_down')
  await live.router.close().catch(() => {})
  await live.sandbox.destroy().catch(() => {})
  live.link.close()
  return true
}
