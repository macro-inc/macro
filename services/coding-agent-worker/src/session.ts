import { randomUUID } from 'node:crypto'
import type {
  InitializeRequest,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
} from '@zed-industries/agent-client-protocol'
import { env } from './env'
import { DaytonaProvider } from './providers/daytona'
import type { AcpConnection, AgentSandbox } from './interfaces'
import { UpstreamLink } from './upstream'

const ACP_PROTOCOL_VERSION = 1

/** Boot sequencer + frame router. The worker is only the ACP client for the
 * boot sequence (initialize, session/new, kickoff prompt), using namespaced
 * string ids ("sys:N") so they can never collide with upstream's ids. All
 * frames — ours, upstream's, and every byte opencode emits — are relayed to
 * the upstream verbatim as tagged `acp` messages. */
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
    } catch (error) {
      console.error('[session] agent stream failed', error)
    }
    this.onAgentExit()
  }
}

type LiveSession = { sandbox: AgentSandbox; router: SessionRouter; link: UpstreamLink }
const sessions = new Map<string, LiveSession>()
const provider = new DaytonaProvider()

/** Kick off a session: returns the id immediately; all progress streams to the
 * session-scoped upstream WebSocket as tagged system and ACP messages. */
export function startSession(opts: { repoUrl: string; prompt: string }): string {
  const sessionId = randomUUID()
  void run(sessionId, opts)
  return sessionId
}

async function run(sessionId: string, opts: { repoUrl: string; prompt: string }): Promise<void> {
  const link = new UpstreamLink(env.UPSTREAM_WS_URL, sessionId)

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
