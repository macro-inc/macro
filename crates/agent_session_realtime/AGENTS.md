# agent_session_realtime

## What it is

Part of agent sessions: fans out newly appended agent session log frames,
from Kafka to whoever is subscribed over GraphQL, so an open session view
updates live.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the fan-out service —
  hands each consumed run of frames to its session's subscribers.
- `src/outbound/log_topic_consumer.rs`: the Kafka consumer for
  `macro.agent_session_log` (behind the `consumer` feature).

## Scope

- Owns: fanning out already-published log frames to live subscribers. No
  composition root and no background tasks start here — the host owns that.
- Not here: writing session log frames → `agent_session`; the GraphQL
  subscription resolver itself → `complete_graph`.

## Boundaries

- Depends on: `agent_session` (log frame shape).
- Used by: `complete_graph` (the GraphQL `agentSessionLogAppended`
  subscription, its sole consumer).

## Checks

- `cargo test -p agent_session_realtime` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/observability.md`
