# agent_monitor

## What it is

The collector behind the macrod agent monitor: one normalized model of every
agent on the machine (hc terminals, Claude and Codex sessions, macrod sessions,
managers, work runs) and the pull requests they open, reduced from source
observations by a single-writer store and served to viewers over gRPC on a user-only Unix socket.

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
- `src/outbound/transcript_feed.rs`: `LocalTranscripts`, the drill-in's
  `TranscriptFeed` for Claude Code transcripts and Codex rollouts (tail of
  the agent's `transcript` file, then appends woken by a directory watch).
- `src/outbound/github.rs`: the one polled source. PR status for what the
  store wants (`Store::pr_interest`: PRs named by transcripts and managers'
  `prs` files, plus agent branches) in one batched GraphQL query per 100
  lookups through `gh api graphql` (`github/query.rs`); a failed query keeps
  the other queries' answers; `gh` and `git` sit behind
  `GithubBackend` so tests answer from `fixtures/github/`.
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
  adapter needs its own kind. `SourceKind::Daemon` belongs to the hosting
  macrod (`coding_agent_worker/src/monitor/daemon_source.rs`) and only reports
  health.
- Socket paths must fit `SUN_LEN` (about 100 bytes); deep temp dirs fail to bind.
- One collector per socket is enforced by a lock on `<socket>.lock` held for the
  server's life (`inbound::grpc::BoundSocket`), not by probing the socket.
- Store tests use `#[tokio::test(start_paused = true)]`; the coalescing window
  and tick then advance without sleeping.
- Sources never build `Agent`s and never decode another source's facts; label
  and file-format meanings are decoded in the adapter.
- Sources are push-driven: `hc events` stdout and `notify` watches. The only
  timers are hc's 45 s silence watchdog, the 30 s reconcile `stat` sweep, and
  the `github` source, which polls GitHub every `[monitor] pr_poll_secs` while
  a viewer is subscribed and at most every 5 minutes otherwise.
  `notify`'s inotify mask includes `IN_OPEN`, so busy transcript directories
  wake the watcher often; those are real writes, not polling.
- PR authorship comes from transcripts, never from GitHub: Claude Code's
  `toolUseResult.gitOperation.pr` (`action: created`), else a call whose
  shell command runs `gh pr create` (`outbound/pr_create.rs`: quoted text,
  heredoc bodies and other programs' arguments don't count) paired with the
  PR URL in that call's own result, and only a successful one. A PR's agents list its author
  first and managers last; merged and closed PRs older than the history
  window are retired (`Facts::prune`) and never asked for again.
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
