import { randomUUID } from 'node:crypto'
import { pushable } from 'it-pushable'
import type { Inbound, ServiceLink } from '../protocol/port'
import {
  AcpMessage,
  Command,
  type AcpDelivery,
  type AgentTarget,
  type CommandResult,
  type SystemEvent,
  type SystemEventName,
} from '../protocol/types'
import { CarrierConnection } from './carrier'
import { connectWebSocket, jsonFrames, type Duplex } from './duplex'
import { JsonRpc } from './rpc/jsonrpc'
import { RpcError, serveParsed, type RawRpc } from './rpc/raw'

export class RuntimeServiceLink implements ServiceLink {
  readonly #rpc: RawRpc
  readonly #carrier: Duplex<unknown>
  readonly #inbound = pushable<Inbound>({ objectMode: true })
  #sequence = 0

  constructor(carrier: Duplex<unknown>) {
    this.#carrier = carrier
    this.#rpc = new JsonRpc(carrier)

    serveParsed(
      this.#rpc,
      'command',
      Command,
      (command) =>
        // Settles when the runtime loop answers via the closures.
        new Promise<CommandResult>((resolve, reject) => {
          this.#inbound.push({
            kind: 'command',
            command,
            respond: resolve,
            fail: (message) => reject(new RpcError(-32603, message)),
          })
        }),
    )
    serveParsed(this.#rpc, 'acp', AcpMessage, ({ agentId, agentInstanceId, message }) => {
      this.#inbound.push({ kind: 'acp', target: { agentId, agentInstanceId }, frame: message })
    })

    carrier.onClose(() => this.#inbound.end())
  }

  get inbound(): AsyncIterable<Inbound> {
    return this.#inbound
  }

  event(name: SystemEventName, opts?: { target?: AgentTarget; payload?: unknown }): void {
    const base = {
      eventId: randomUUID(),
      sequence: ++this.#sequence,
      name,
      occurredAt: new Date().toISOString(),
      ...(opts?.payload !== undefined && { payload: opts.payload }),
    }
    // Two-branch construction so the both-or-neither agent scoping rule is
    // enforced by the SystemEvent type itself.
    const event: SystemEvent = opts?.target
      ? { ...base, agentId: opts.target.agentId, agentInstanceId: opts.target.agentInstanceId }
      : base
    this.#rpc.notify('system_event', event)
  }

  acp(target: AgentTarget, frame: unknown): void {
    const delivery: AcpDelivery = {
      messageId: randomUUID(),
      agentId: target.agentId,
      agentInstanceId: target.agentInstanceId,
      message: frame,
    }
    this.#rpc.notify('acp', delivery)
  }

  async close(): Promise<void> {
    await this.#carrier.close()
  }
}

/** Dial, subscribe, and stack: ws (Duplex<string>) → json (Duplex<unknown>) →
 * carrier (Duplex<unknown>, one layer up) → ServiceLink. */
export async function connectServiceLink(url: string): Promise<ServiceLink> {
  const socket = await connectWebSocket(url)
  const carrier = await CarrierConnection.connect(jsonFrames(socket))
  return new RuntimeServiceLink(carrier)
}
