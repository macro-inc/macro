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
- `src/domain/join.rs`: the join table in code, status rules, cost estimates
  and per-minute spend; `src/domain/pricing.rs`: list prices and their sources.
- `src/outbound/local.rs`: every real-machine source from a few roots. File
  sources share `outbound/transcripts.rs` (tailed JSON lines) or
  `outbound/records.rs` (small whole-file records).

## Recipes

- Try it without macrod: `cargo run -p agent_monitor --example monitor -- serve
  --demo --socket <path>`, then `... -- dump --socket <path> --count 50`.
- Add a source: an adapter in `src/outbound/` implementing `AgentSource` with
  its own `SourceKind`; decode its facts into `Fact`s, never `Agent`s.
- A fixed state for snapshot tests: `outbound::demo::snapshot(seed, start, step, steps)`.
- Check the real sources and the join on this machine: `cargo run --release -p
  agent_monitor --example sources_dump -- --home ~ [--run-dir <dir>]... [--idle 60]`;
  live terminals in its output should match `hc ls --json`.
- A new transcript format: a `TranscriptFormat` (file → key) and `LineParser`
  (substring prefilter, then parse); the engine does watching, indexing and tailing.
- A new model: add its row to `domain::pricing` from the provider's published
  page; an unknown model stays `Cost::Unpriced`.

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
- Sources are push-driven: `hc events` stdout and `notify` watches. The only
  timers are hc's 45 s silence watchdog and the 30 s reconcile `stat` sweep.
  `notify`'s inotify mask includes `IN_OPEN`, so busy transcript directories
  wake the watcher often; those are real writes, not polling.
- Startup indexes only transcripts modified within the history window, newest
  first on four blocking workers; never read the whole projects tree.
- The Claude Code registry directory holds key files beside `<pid>.json`;
  only `<pid>.json` is ever opened.
- A Claude Code `cost-state` total covers the session's subagents; the join
  keeps rows additive by taking subagent estimates out of the main row.
- Never put transcript text, prompts or tool arguments on spans, logs, rows or
  tape lines; only `FollowTranscript` carries text (`.agents/rules/observability.md`).

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/code.md`
