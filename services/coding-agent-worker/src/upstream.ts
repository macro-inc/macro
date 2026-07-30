import type { ToRuntimeMessage, ToServerMessage } from './protocol/generated'
import { log } from './log'

const MAX_PENDING_ACP_MESSAGES = 1_024

/** One session-scoped WebSocket carrying agent_runtime_protocol's direct
 * tagged messages: no RPC envelope, just one JSON `ToServerMessage`/
 * `ToRuntimeMessage` value per frame. This worker plays the Agent Runtime
 * role, so it sends `ToServerMessage` and receives `ToRuntimeMessage`. */
export class UpstreamLink {
  private _onAcp: (frame: unknown) => void = () => {}
  private onAcpAttached = false

  /** Handler for ACP frames relayed from the upstream. Frames that arrive
   * before this is set - e.g. a proxy-initiated `session/new` sent the
   * instant this link connects, well before the caller's own downstream
   * connection to the agent process exists to wire a real handler up to -
   * are queued and delivered the moment it is, mirroring `pendingAcp`'s
   * buffering in the outgoing direction. Without this, anything sent that
   * early is silently dropped: the default no-op swallows it and no error
   * or retry ever surfaces the loss. */
  set onAcp(handler: (frame: unknown) => void) {
    this._onAcp = handler
    this.onAcpAttached = true
    if (this.pendingIncomingAcp.length > 0) {
      log.debug(
        `[upstream ${this.sessionId}] onAcp attached, flushing ${this.pendingIncomingAcp.length} queued frame(s)`,
      )
    }
    for (const frame of this.pendingIncomingAcp.splice(0)) handler(frame)
  }

  get onAcp(): (frame: unknown) => void {
    return this._onAcp
  }

  private ws: WebSocket | null = null
  private open = false
  private closed = false
  private currentEvent: string | null = null
  private readonly pendingAcp: unknown[] = []
  private readonly pendingIncomingAcp: unknown[] = []
  private readonly url: string

  constructor(
    url: string,
    private readonly sessionId: string,
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
    log.debug(`[upstream ${this.sessionId}] -> acp`, frame)
    this.send(acpMessage(frame))
  }

  /** Report a lifecycle event to the upstream (e.g. `booting`, `ready`, `shutting_down`). */
  status(event: string) {
    log.info(`[upstream ${this.sessionId}] status -> ${event}`)
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
      log.debug(`[upstream ${this.sessionId}] socket not open, queueing`, message)
      if (message.type === 'acp') this.queueAcp(acpPayload(message))
      return
    }
    try {
      this.ws?.send(JSON.stringify(message))
    } catch (error) {
      log.warn(`[upstream ${this.sessionId}] send failed, queueing`, error)
      this.open = false
      if (message.type === 'acp') this.queueAcp(acpPayload(message))
    }
  }

  private queueAcp(frame: unknown) {
    if (this.pendingAcp.length >= MAX_PENDING_ACP_MESSAGES) {
      throw new Error(`upstream outgoing ACP queue exceeded ${MAX_PENDING_ACP_MESSAGES} messages`)
    }
    this.pendingAcp.push(frame)
    log.debug(`[upstream ${this.sessionId}] queued outgoing ACP frame (${this.pendingAcp.length} pending)`)
  }

  private queueIncomingAcp(frame: unknown) {
    if (this.pendingIncomingAcp.length >= MAX_PENDING_ACP_MESSAGES) {
      throw new Error(`upstream incoming ACP queue exceeded ${MAX_PENDING_ACP_MESSAGES} messages`)
    }
    this.pendingIncomingAcp.push(frame)
    log.debug(
      `[upstream ${this.sessionId}] queued incoming ACP frame, onAcp not attached yet (${this.pendingIncomingAcp.length} pending)`,
    )
  }

  private dial() {
    if (this.closed) return
    log.info(`[upstream ${this.sessionId}] dialing ${this.url}`)
    const ws = this.socketFactory(this.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      if (this.ws !== ws || this.closed) return
      log.info(`[upstream ${this.sessionId}] connected`)
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
        log.error(`[upstream ${this.sessionId}] ignoring invalid upstream message`, event.data)
        return
      }
      const frame = acpPayload(payload)
      log.debug(`[upstream ${this.sessionId}] <- acp`, frame)
      if (this.onAcpAttached) this._onAcp(frame)
      else this.queueIncomingAcp(frame)
    })
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return
      log.warn(`[upstream ${this.sessionId}] socket closed`, { code: event.code, reason: event.reason })
      this.open = false
      if (!this.closed) setTimeout(() => this.dial(), this.reconnectDelayMs)
    })
    ws.addEventListener('error', (event) => {
      log.error(`[upstream ${this.sessionId}] socket error`, event)
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
