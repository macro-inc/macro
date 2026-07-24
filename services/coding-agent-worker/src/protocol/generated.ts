// GENERATED FILE — do not edit.
// Source of truth: crates/agent_runtime_protocol/src/schema/v0/mod.rs
// Regenerate with: just gen-protocol

import { z } from 'zod'

export const SystemEvent = z.object({ "eventId": z.string().describe("Stable identifier reused when replaying this logical event."), "sequence": z.number().int().gte(0).describe("Monotonically increasing sequence within a runtime instance."), "name": z.string().describe("Typed event name with forward-compatible handling of unknown values."), "occurredAt": z.string().describe("UTC occurrence time formatted according to RFC 3339."), "agentId": z.union([z.string().describe("Stable logical agent identifier for an agent-scoped event."), z.null().describe("Stable logical agent identifier for an agent-scoped event.")]).describe("Stable logical agent identifier for an agent-scoped event.").optional(), "agentInstanceId": z.union([z.string().describe("Current agent-process identifier for an agent-scoped event."), z.null().describe("Current agent-process identifier for an agent-scoped event.")]).describe("Current agent-process identifier for an agent-scoped event.").optional(), "payload": z.any().describe("Event-specific JSON payload.").optional() }).describe("A runtime or agent state transition sent to the Agent Service.")
export type SystemEvent = z.infer<typeof SystemEvent>

export const Command = z.object({ "commandId": z.string().describe("Stable identifier reused when retrying this logical command."), "name": z.string().describe("Typed command name with forward-compatible handling of unknown values."), "agentId": z.union([z.string().describe("Stable logical agent identifier for an agent-scoped command."), z.null().describe("Stable logical agent identifier for an agent-scoped command.")]).describe("Stable logical agent identifier for an agent-scoped command.").optional(), "agentInstanceId": z.union([z.string().describe("Current agent-process identifier when the command targets one execution."), z.null().describe("Current agent-process identifier when the command targets one execution.")]).describe("Current agent-process identifier when the command targets one execution.").optional(), "payload": z.any().describe("Command-specific JSON payload.").optional() }).describe("An operation requested by the Agent Service and handled by the Agent Runtime.")
export type Command = z.infer<typeof Command>

export const CommandResult = z.object({ "value": z.any().describe("Optional command-specific result value.").optional(), "status": z.literal("completed") }).describe("The command completed synchronously.").describe("Result of executing a command.")
export type CommandResult = z.infer<typeof CommandResult>

export const AcpMessage = z.object({ "messageId": z.string().describe("Unique identifier for this outer ACP delivery."), "agentId": z.string().describe("Stable logical identifier of the target agent."), "agentInstanceId": z.string().describe("Identifier of the target agent process execution."), "message": z.any().describe("Complete nested ACP JSON-RPC request, notification, or response.") }).describe("One complete ACP JSON-RPC message routed to a running agent instance.")
export type AcpMessage = z.infer<typeof AcpMessage>
