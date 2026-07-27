import type { ToRuntimeMessage, ToServerMessage } from './protocol/generated'

const MAX_PENDING_ACP_MESSAGES = 1_024

/** One session-scoped WebSocket carrying agent_runtime_protocol's direct
 * tagged messages: no RPC envelope, just one JSON `ToServerMessage`/
 * `ToRuntimeMessage` value per frame. This worker plays the Agent Runtime
 * role, so it sends `ToServerMessage` and receives `ToRuntimeMessage`. */
export class UpstreamLink {
  onAcp: (frame: unknown) => void = () => {}

  private ws: WebSocket | null = null
  private open = false
  private closed = false
  private currentEvent: string | null = null
  private readonly pendingAcp: unknown[] = []
  private readonly url: string

  constructor(
    url: string,
    sessionId: string,
    private readonly socketFactory: (url: string) => WebSocket = (socketUrl) => new WebSocket(socketUrl),
    private readonly reconnectDelayMs = 1_000,
  ) {
    const endpoint = new URL(url)
    endpoint.searchParams.set('id', sessionId)
    this.url = endpoint.toString()
    this.dial()
  }

  /** Send an ACP frame to the upstream. */
  acp(frame: unknown) {
    this.send(acpMessage(frame))
  }

  /** Report a lifecycle event to the upstream (e.g. `booting`, `ready`, `shutting_down`). */
  status(event: string) {
    this.currentEvent = event
    this.send({ type: 'event', event })
  }

  close() {
    this.closed = true
    try {
      this.ws?.close()
    } catch {}
  }

  private send(message: ToServerMessage) {
    if (!this.open) {
      if (message.type === 'acp') this.queueAcp(acpPayload(message))
      return
    }
    try {
      this.ws?.send(JSON.stringify(message))
    } catch {
      this.open = false
      if (message.type === 'acp') this.queueAcp(acpPayload(message))
    }
  }

  private queueAcp(frame: unknown) {
    if (this.pendingAcp.length >= MAX_PENDING_ACP_MESSAGES) {
      throw new Error(`upstream ACP queue exceeded ${MAX_PENDING_ACP_MESSAGES} messages`)
    }
    this.pendingAcp.push(frame)
  }

  private dial() {
    if (this.closed) return
    const ws = this.socketFactory(this.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      if (this.ws !== ws || this.closed) return
      this.open = true
      if (this.currentEvent) this.send({ type: 'event', event: this.currentEvent })
      for (const frame of this.pendingAcp.splice(0)) this.send(acpMessage(frame))
    })
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws || this.closed) return
      let payload: ToRuntimeMessage
      try {
        const parsed: unknown = JSON.parse(String(event.data))
        if (!isRuntimeMessage(parsed)) throw new Error('invalid message')
        payload = parsed
      } catch {
        return console.error('[link] ignoring invalid upstream message')
      }
      this.onAcp(acpPayload(payload))
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.open = false
      if (!this.closed) setTimeout(() => this.dial(), this.reconnectDelayMs)
    })
    ws.addEventListener('error', () => {
      try {
        ws.close()
      } catch {}
    })
  }
}

/** Wrap a raw ACP frame as the `acp` variant of `ToServerMessage`/`ToRuntimeMessage`.
 * `AcpMessage` flattens the frame's own JSON-RPC fields directly alongside the
 * `type` tag on the wire, so there is no separate `message` wrapper key. */
function acpMessage(frame: unknown): ToServerMessage {
  return { type: 'acp', ...(frame as Record<string, unknown>) } as unknown as ToServerMessage
}

/** Recover the raw ACP frame from an `acp`-tagged message (the inverse of `acpMessage`). */
function acpPayload(message: { type: 'acp' }): unknown {
  const { type: _type, ...frame } = message as { type: 'acp' } & Record<string, unknown>
  return frame
}

function isRuntimeMessage(value: unknown): value is ToRuntimeMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'acp'
}
