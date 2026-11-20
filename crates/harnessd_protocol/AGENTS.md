# harnessd_protocol

## What it is

The wire types of `harnessd`, the agent sign-in daemon on a Macro computer:
JSON lines the control plane writes to `harnessd` over `Fleet::exec`, and the
lines it answers with. Also the one `AgentProvider` enum, which `harnesses`,
`model_notifications` and the control plane re-use.

## Scope

- Owns: `Request`, `Response`, `ClaudeAccount`, `ErrorKind`, `AgentProvider`.
- Not here: the daemon and its Claude adapter → `crates/harnessd`; driving it
  from the control plane → `services/agent_harness_service/src/computers`.

## Boundaries

- Depends on: serde, chrono, strum only. `schema` adds `utoipa::ToSchema`,
  `sqlx` adds the Postgres `agent_provider` type.
- Used by: `crates/harnessd`, `crates/harnesses`, `crates/model_notifications`,
  `services/agent_harness_service`.

## Checks

- `cargo test -p harnessd_protocol`

## Gotchas

- harnessd and the control plane deploy separately (the image pins harnessd),
  so a field change must keep reading what the other side already sends.
- A new agent adds an `AgentProvider` variant, a value in the Postgres
  `agent_provider` enum, and its own optional field on `Response::SignedIn`.
