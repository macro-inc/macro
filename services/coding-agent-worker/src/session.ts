import { randomUUID } from 'node:crypto'
import {
  type AnyMessage,
  type Client,
  ClientSideConnection,
  ndJsonStream,
} from '@zed-industries/agent-client-protocol'
import { env } from './env'
import { WORKSPACE_DIR } from './provision'
import { DaytonaProvider } from './providers/daytona'
import type { AcpConnection, AgentSandbox } from './interfaces'
import { UpstreamLink } from './upstream'

const ACP_PROTOCOL_VERSION = 1

/** Agent→client calls during the boot turn. Permissions are cancelled (the
 * worker granted no capabilities) and updates are ignored here: the upstream
 * sees every frame via the mirror and reacts there. */
const bootClient: Client = {
  async requestPermission() {
    return { outcome: { outcome: 'cancelled' } }
  },
  async sessionUpdate() {},
}

/** ACP client for the boot sequence (initialize, session/new, kickoff
 * prompt), with both directions mirrored verbatim to the upstream. The ACP
 * SDK does all framing and request/response correlation. */
class SessionRouter {
  onAgentExit: () => void = () => {}

  private readonly agent: ClientSideConnection

  constructor(
    private readonly conn: AcpConnection,
    link: UpstreamLink,
  ) {
    const wire = ndJsonStream(conn.writable, conn.readable)
    const toAgent = wire.writable.getWriter()

    // agent → us: mirror upstream, then hand to the SDK. A clean EOF is the
    // agent exiting (the sidecar closes the socket when the harness dies).
    const inbound = wire.readable.pipeThrough(
      new TransformStream<AnyMessage, AnyMessage>({
        transform: (frame, controller) => {
          link.acp(frame)
          controller.enqueue(frame)
        },
        flush: () => this.onAgentExit(),
      }),
    )

    // us → agent: mirror what the SDK sends, then forward it.
    const outbound = new TransformStream<AnyMessage, AnyMessage>()
    void (async () => {
      const reader = outbound.readable.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        link.acp(value)
        await toAgent.write(value)
      }
    })()

    // Frames the upstream relays go straight through (it sent them; no echo).
    link.onAcp = (frame) => void toAgent.write(frame as AnyMessage)

    this.agent = new ClientSideConnection(() => bootClient, {
      readable: inbound,
      writable: outbound.writable,
    })
  }

  async boot(cwd: string, prompt: string): Promise<void> {
    await this.agent.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    const { sessionId } = await this.agent.newSession({ cwd, mcpServers: [] })
    if (!sessionId) throw new Error('session/new returned no sessionId')

    // Fire the kickoff prompt; its turn completes as a relayed ACP response.
    void this.agent.prompt({ sessionId, prompt: [{ type: 'text', text: prompt }] }).catch(() => {})
  }

  async close(): Promise<void> {
    await this.conn.close()
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

    await router.boot(WORKSPACE_DIR, opts.prompt)
    link.status('ready')
  } catch (e) {
    console.error('[session] boot failed', e)
    if (sessions.has(sessionId)) {
      await destroySession(sessionId)
    } else {
      link.status('shutting_down')
      await sandbox?.release().catch(() => {})
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
  await live.sandbox.release().catch(() => {})
  live.link.close()
  return true
}
