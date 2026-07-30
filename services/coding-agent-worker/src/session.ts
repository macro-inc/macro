import { randomUUID } from 'node:crypto'
import { type AnyMessage, ndJsonStream } from '@agentclientprotocol/sdk'
import { Macro } from '@macro/sdk'
import { isJsonRpcMessage } from './acp/jsonrpc'
import { env } from './env'
import { log } from './log'
import { DaytonaProvider } from './providers/daytona'
import type { AcpConnection, AgentSandbox } from './interfaces'
import { UpstreamLink } from './upstream'

/** Frame router between the sandbox's ACP connection and the upstream link.
 * The worker itself never speaks ACP - it neither initializes the agent nor
 * creates a session; agent_proxy owns that handshake (and every ACP
 * session), sent down over the same upstream link this relays into the
 * sandbox. Every frame in either direction — upstream's, and every byte
 * opencode emits — is relayed verbatim. */
class SessionRouter {
  onAgentExit: () => void = () => {}

  private readonly writer: WritableStreamDefaultWriter<AnyMessage>

  constructor(
    private readonly conn: AcpConnection,
    private readonly link: UpstreamLink,
    private readonly sessionId: string,
  ) {
    // NDJSON framing only. The SDK's connection layer is deliberately not
    // used: agent_proxy owns the ACP session, so this end correlates nothing.
    const wire = ndJsonStream(conn.writable, conn.readable)
    this.writer = wire.writable.getWriter()
    link.onAcp = (frame) => this.writeToAgent(frame)
    void this.pump(wire.readable)
  }

  async close(): Promise<void> {
    try {
      this.writer.releaseLock()
    } catch {}
    await this.conn.close()
  }

  private writeToAgent(frame: unknown) {
    if (!isJsonRpcMessage(frame)) {
      log.error(`[session ${this.sessionId}] upstream sent a non-JSON-RPC frame`, { frame })
      return
    }
    log.debug(`[session ${this.sessionId}] -> agent`, frame)
    void this.writer.write(frame).catch((error) => {
      log.error(`[session ${this.sessionId}] write to agent failed`, error)
    })
  }

  private async pump(readable: ReadableStream<AnyMessage>): Promise<void> {
    const reader = readable.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          log.warn(`[session ${this.sessionId}] agent stream closed (done)`)
          break
        }
        log.debug(`[session ${this.sessionId}] <- agent`, value)
        this.link.acp(value)
      }
    } catch (error) {
      log.error(`[session ${this.sessionId}] agent stream failed`, error)
    }
    this.onAgentExit()
  }
}

type LiveSession = { sandbox: AgentSandbox; router: SessionRouter; link: UpstreamLink }
const sessions = new Map<string, LiveSession>()
const provider = new DaytonaProvider()

/** Kick off a session: returns the id immediately; all progress streams to the
 * session-scoped upstream WebSocket as tagged system and ACP messages.
 *
 * `agentId`, when given, is agent_proxy's chat/agent id and becomes the
 * session id verbatim (the shared runtime endpoint's `?id=` is matched
 * against it on the other end). Without it, a fresh id is generated - the
 * standalone dev-fixture flow doesn't have an agent_proxy chat to match. */
export function startSession(opts: { repoUrl: string; prompt: string; agentId?: string }): string {
  const sessionId = opts.agentId ?? randomUUID()
  void run(sessionId, opts)
  return sessionId
}

async function run(
  sessionId: string,
  opts: { repoUrl: string; prompt: string; agentId?: string },
): Promise<void> {
  const link = new UpstreamLink(env.UPSTREAM_WS_URL, sessionId)
  let sandbox: AgentSandbox | null = null
  try {
    // The kickoff prompt goes to agent_proxy's HTTP API, not the
    // websocket: the proxy durably queues it and delivers it as the
    // session's first `session/prompt` once this runtime's ACP session is
    // bootstrapped. Posted before the sandbox exists on purpose - the
    // queue is exactly what makes that safe.
    if (opts.agentId) await postInitialPrompt(opts.agentId, opts.prompt)
    link.status('booting')
    log.info(`[session ${sessionId}] spawning sandbox`, { repoUrl: opts.repoUrl })
    sandbox = await provider.spawn({
      repoUrl: opts.repoUrl,
      envVars: {
        GITHUB_TOKEN: env.GITHUB_TOKEN,
        ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
      },
    })
    log.info(`[session ${sessionId}] sandbox up, connecting to ACP sidecar`, { sandboxId: sandbox.id })

    const conn = await sandbox.connect()
    log.info(`[session ${sessionId}] ACP sidecar connected, wiring session router`)
    const router = new SessionRouter(conn, link, sessionId)
    router.onAgentExit = () => void destroySession(sessionId)
    sessions.set(sessionId, { sandbox, router, link })

    // Matches agent_runtime_protocol's `SystemEvent::AcpReady` wire name:
    // agent_proxy waits for this exact event before starting the ACP
    // `initialize`/`session/new` handshake, since only now is the sandbox's
    // ACP connection actually wired up to receive it.
    link.status('acp_ready')
  } catch (e) {
    log.error(`[session ${sessionId}] sandbox setup failed`, e)
    if (sessions.has(sessionId)) {
      await destroySession(sessionId)
    } else {
      link.status('shutting_down')
      await sandbox?.release().catch(() => {})
      link.close()
    }
  }
}

/** agent_proxy's HTTP base URL, derived from the upstream WS URL (they
 * are the same service): `ws(s)://host/...` -> `http(s)://host`. */
function agentProxyHttpUrl(): string {
  const url = new URL(env.UPSTREAM_WS_URL)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

/** Post the session's kickoff prompt to agent_proxy through the Macro SDK. */
async function postInitialPrompt(agentId: string, prompt: string): Promise<void> {
  const macro = new Macro({
    env: env.MACRO_ENV as 'local' | 'dev' | 'prod',
    hosts: { 'agent-proxy': agentProxyHttpUrl() },
  })
  await macro.agents.byId(agentId).prompt(prompt)
  log.info(`[session ${agentId}] kickoff prompt posted to agent proxy`)
}

export async function destroySession(id: string): Promise<boolean> {
  const live = sessions.get(id)
  if (!live) return false
  sessions.delete(id)
  live.link.status('shutting_down')
  await live.router.close().catch(() => {})
  await live.sandbox.release().catch(() => {})
  live.link.close()
  return true
}
