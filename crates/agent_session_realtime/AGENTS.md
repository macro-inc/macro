# agent_session_realtime

## What it is

Part of agent sessions: fans out newly appended agent session log frames,
from the harness' Redis Stream to whoever is subscribed over GraphQL, so an
open session view updates live.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the fan-out service —
  hands each consumed run of frames to its session's subscribers.
- `src/outbound/redis_stream.rs`: the `agent_session_log:v1` stream; its
  `publisher` wraps the harness' realtime and its `consumer` feeds the
  fan-out (both behind the `redis` feature).

## Scope

- Owns: fanning out already-published log frames to live subscribers. No
  composition root and no background tasks start here — the host owns that.
- Not here: writing session log frames → `agent_session`; the GraphQL
  subscription resolver itself → `complete_graph`.

## Boundaries

- Depends on: `agent_session` (log frame shape).
- Used by: `complete_graph` (the GraphQL `agentSessionLogAppended`
  subscription, its sole consumer).

## Gotchas

- A subscriber that falls 16 runs behind (a wake's `session/load` replay is a
  burst) is closed, and its GraphQL stream ends with an error. That is the
  contract, not a fault: the web watch (`apps/web/src/lib/queries/agent-session/log.ts`)
  reopens the subscription and refetches the log. A client that does not
  reopen hears nothing more from the session.

## Checks

- `cargo test -p agent_session_realtime` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/observability.md`
