# agent_monitor

## What it is

The collector behind the macrod agent monitor: one normalized model of every
agent on the machine (hc terminals, Claude and Codex sessions, macrod sessions,
managers, work runs), reduced from source observations by a single-writer
store and served to viewers over gRPC on a user-only Unix socket.

## How it works

Sources (`domain::source::AgentSource`, run by `domain::supervisor`) send
`domain::observation::Observation`s into one bounded mpsc. The store's reducer
(`domain::store`) applies them to `domain::join::Facts`, rebuilds agents with
`build_agents`, diffs against the published rows, and publishes sequenced
`Update`s on a broadcast. `Subscribe` sends a snapshot, then deltas; a lagging
subscriber gets a fresh snapshot.

## Start here

- `src/domain/model.rs`: the agent model and the updates viewers receive.
- `src/domain/observation.rs`: what sources send, and the reducer's join table.
- `src/domain/store.rs`: the single writer, subscribe rules, tape and totals.
- `proto/agent_monitor.proto`: the wire contract; `src/proto.rs` converts it.
- `src/inbound/grpc.rs` and `src/client.rs`: socket rules, server, client.

## Recipes

- Try it without macrod: `cargo run -p agent_monitor --example monitor -- serve
  --demo --socket <path>`, then `... -- dump --socket <path> --count 50`.
- Add a source: an adapter in `src/outbound/` implementing `AgentSource` with
  its own `SourceKind`; decode its facts into `Fact`s, never `Agent`s.
- A fixed state for snapshot tests: `outbound::demo::snapshot(seed, start, step, steps)`.

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
- `Change::Reset` replaces every fact filed under its `SourceKind`, so each
  adapter needs its own kind.
- Socket paths must fit `SUN_LEN` (about 100 bytes); deep temp dirs fail to bind.
- One collector per socket is enforced by a lock on `<socket>.lock` held for the
  server's life (`inbound::grpc::BoundSocket`), not by probing the socket.
- Store tests use `#[tokio::test(start_paused = true)]`; the coalescing window
  and tick then advance without sleeping.
- Sources never build `Agent`s and never decode another source's facts; label
  and file-format meanings are decoded in the adapter.
- Never put transcript text, prompts or tool arguments on spans, logs, rows or
  tape lines; only `FollowTranscript` carries text (`.agents/rules/observability.md`).

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/code.md`
