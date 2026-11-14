# agent_monitor

## What it is

The collector behind the macrod agent monitor: one normalized model of every
agent on the machine (hc terminals, Claude and Codex sessions, macrod sessions,
managers, work runs), reduced from source observations by a single-writer
store and served to viewers over gRPC on a user-only Unix socket.

## How it works

Sources (`domain::source::AgentSource`) send `domain::observation::Observation`s
into one bounded mpsc. The store's reducer is the only code that builds an
`Agent`; it publishes sequenced `Update`s. `Subscribe` sends a snapshot, then
deltas; a lagging subscriber gets a fresh snapshot.

## Start here

- `src/domain/model.rs`: the agent model and the updates viewers receive.
- `src/domain/observation.rs`: what sources send, and the reducer's join table.
- `proto/agent_monitor.proto`: the wire contract; `src/proto.rs` converts it.

## Scope

- Owns: the model, the store, source adapters, the proto, the server and client.
- Not here: the viewer → `crates/agent_monitor_tui`; the `macrod monitor`
  subcommands and hosting → `crates/coding_agent_worker`.

## Checks

- `cargo nextest run --all-features -p agent_monitor`
- After a dependency change: `just hakari`.

## Gotchas

- `build.rs` compiles the proto with `protox`; no `protoc` is needed. Bump
  `proto::PROTOCOL` on any incompatible proto change.
- Sources never build `Agent`s and never decode another source's facts; label
  and file-format meanings are decoded in the adapter.
- Never put transcript text, prompts or tool arguments on spans, logs, rows or
  tape lines; only `FollowTranscript` carries text (`.agents/rules/observability.md`).

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/code.md`
