# external_agents

## What it is

Part of agents: agent personas whose runtime lives outside Macro (an outside
assistant, a hosted bot). People DM and @mention them like any agent; their
runtime reads the messages that addressed it and answers with its bot token.

## How it works

`agent_trigger` decides when a message addresses an agent. The DSS consumer
(`inbound/kafka_consumer.rs`) records each trigger for an external agent as
one event in `external_agent_events` (`domain/inbox.rs`). An agent with a
webhook endpoint also gets the event pushed through the webhook delivery queue
as `external_agent.message`; one without polls `externalAgent.events`. A reply
names its event, which says where it goes and whose access writes it
(`domain/api.rs`).

## Start here

- `src/domain/ports.rs`: every port, and the inbound traits GraphQL calls.
- `src/domain/registry.rs`: registration, endpoints, tokens, deletion.
- `src/domain/inbox.rs` + `src/domain/api.rs`: recording, reading, replying.
- `src/domain/models.rs`: `MessageEventEnvelope`, the pushed wire contract.

## Scope

- Owns: `external_agents`, `external_agent_events`, the `external_agent.message`
  contract, and reply authorization from an event.
- Not here: the persona and its tokens → `crates/bots`; signing, retries, and
  delivery records → `crates/webhook`; deciding who is addressed →
  `crates/agent_trigger`; the GraphQL surface → `crates/graphql_external_agent`.

## Boundaries

- Depends on: `bots`, `webhook` (outbound), `agent_trigger` (event vocabulary),
  `messages`, `entity_access`.
- Used by: `services/document_storage_service`, `crates/graphql_external_agent`.

## Recipes

- Change the pushed event: `src/domain/models.rs` → its test in
  `src/outbound/webhook_endpoints/test.rs` → the SDK's `externalAgents` types
  → `docs/guides/external-agents.md`. It is a public contract: add, don't rename.
- Address agents in a new way: teach `agent_trigger` first, then `addressed`
  in `src/domain/inbox.rs`.

## Checks

- `cargo test -p external_agents` (`SQLX_OFFLINE` unset).
- After query changes: `nix develop --command just prepare_db` from the root.

## Gotchas

- Replies are authorized by the stored event, never by the message they name:
  the event fixes the conversation, the thread, and whose current access
  writes the reply.
- Agents without the external harness, or without an `external_agents` row,
  are not external agents: the inbox ignores their triggers.
- Endpoint validation shares the webhook API's per-user rate limit
  (`webhook::inbound::axum_router::validate_webhook_rate_limit_key`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
  · Docs: `docs/guides/external-agents.md`
