import { z } from 'zod'
import * as generated from './generated'

/** Known system event names. */
export type SystemEventName = 'runtime/ready' | 'agent/started' | 'agent/stopped'

/** Known command names. Inbound (peer-chosen), so zod-derived: a command with
 * a name we don't know fails validation instead of masquerading as a known one. */
export const CommandName = z.enum(['runtime/configure'])
export type CommandName = z.infer<typeof CommandName>

/** One execution of an agent within a runtime. Restart = same agentId, new instance. */
export type AgentTarget = { agentId: string; agentInstanceId: string }

/** A runtime/agent state transition we notify the service about. We are the
 * producer (never validated inbound), so this is a plain type; the wire rule
 * that agentId/agentInstanceId appear together is encoded in the union. */
export type SystemEvent = {
  /** Stable identifier reused when replaying this logical event (dedup key). */
  eventId: string
  /** Monotonically increasing within a runtime instance. */
  sequence: number
  name: SystemEventName
  /** RFC 3339. */
  occurredAt: string
  payload?: unknown
} & ({ agentId: string; agentInstanceId: string } | { agentId?: undefined; agentInstanceId?: undefined })

/** Inbound command: generated wire shape, name narrowed to our closed enum. */
export const Command = generated.Command.extend({ name: CommandName })
export type Command = z.infer<typeof Command>

/** Result of executing a command. We are the producer, so plain type. */
export type CommandResult = { status: 'completed'; value?: unknown }

/** An outbound ACP delivery: one opaque nested message plus routing identity.
 * We are the producer, so plain type (inbound deliveries parse via AcpMessage). */
export type AcpDelivery = { messageId: string; agentId: string; agentInstanceId: string; message: unknown }

/** Inbound ACP delivery: generated wire shape, nested message tightened from
 * `any` to a required JSON-RPC-shaped object. */
export const AcpMessage = generated.AcpMessage.extend({ message: z.looseObject({}) })
export type AcpMessage = z.infer<typeof AcpMessage>

type Satisfies<A extends B, B> = A
type _SystemEventOnWire = Satisfies<SystemEvent, generated.SystemEvent>
type _CommandResultOnWire = Satisfies<CommandResult, generated.CommandResult>
type _AcpDeliveryOnWire = Satisfies<AcpDelivery, generated.AcpMessage>
