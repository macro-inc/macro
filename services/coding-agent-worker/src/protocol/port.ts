import type { AgentTarget, Command, CommandResult, SystemEventName } from './types'

/** Everything the service can push at the runtime, decoded and correlated. **/
export type Inbound =
  | { kind: 'command'; command: Command; respond: (result: CommandResult) => void; fail: (message: string) => void }
  | { kind: 'acp'; target: AgentTarget; frame: unknown }

/** The runtime's view of its service connection. Domain-level: the adapter
 * behind it owns all wire bookkeeping (connectionId, subscribe, JSON-RPC ids,
 * event stamping, reconnect + replay). */
export interface ServiceLink {
  /** service -> us. Ends when the link is closed for good. */
  readonly inbound: AsyncIterable<Inbound>
  /** Notify a system event. The adapter stamps eventId/sequence/occurredAt. */
  event(name: SystemEventName, opts?: { target?: AgentTarget; payload?: unknown }): void
  /** Tunnel one ACP frame to the service for `target`. */
  acp(target: AgentTarget, frame: unknown): void
  close(): Promise<void>
}
