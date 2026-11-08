# trigger_context

## What it is

Part of agent sessions: plain data for why an agent was called, shared by
whatever calls an agent, the runtimes that serve it, and the service that composes
its prompt. Plain data so the self-hosted daemon can carry it without the
producers' dependencies.

## Start here

- `src/lib.rs`: `TriggerContext`, the account written for the agent. It carries
  content, and is absent when it could not be read.
- `src/origin.rs`: `TriggerOrigin`, the record of what opened a session. References
  only, known from the source event alone, and stored in `agent_session_source`.

## Scope

- Owns: the vocabulary of both types.
- Not here: rendering a context into a prompt (`services/lexical-service`), storing
  an origin (`agent_session`), or deciding that an agent should run (`agent_trigger`).

## Boundaries

- Depends on: `bot_id`, `macro_user_id`.
- Used by: `agent_trigger`, `agent_session`, `agent_harness`, `scheduled_action`,
  and `macrod`.

## Recipes

- Add an origin: a `TriggerOrigin` variant → its producer → `source_columns` in
  `crates/agents/agent_session/src/outbound/postgres/source.rs` → the table's constraints.
  Hold only references to users and entities, and only fields that path always has.

## Checks

- `cargo test -p trigger_context`.

## Gotchas

- Runtimes are not rolled with a deploy, so new fields default on decode, and an
  origin this build does not know decodes as `Unknown`.
