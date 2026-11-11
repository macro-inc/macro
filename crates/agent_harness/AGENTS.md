# agent_harness

## What it is

Part of agent sessions: orchestrates sandboxed coding-agent sessions end to
end — provisioning containers, speaking to each coding-agent runtime
(Cursor, Codex), routing triggers to a session, and relaying ACP traffic
between the sandbox and the rest of the product.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the harness service and
  the ports every runtime/container provider implements.
- `src/domain/model/coding_preferences/`: workflows injected into coding
  sessions (create-tasks, open-pull-requests). Task mentions use the lexical
  `<m-document-mention>` chip.
- `src/domain/codex.rs`: per-runtime session setup.
- `src/outbound/sidecar.rs` + `sidecar_pump.rs`: the container sidecar
  transport that speaks `agent_runtime_protocol`.
- `src/outbound/containers.rs` / `managed_containers.rs`: container
  provisioning.
- `src/outbound/cursor/manager.rs`: compose Cursor sessions, including public
  prompt-image fetching through the `cursor_cloud_agents` image-fetcher port.
- `src/domain/trigger_router.rs`: routes an incoming trigger to a session.
- `src/domain/runtime_closed.rs`: the turn observer that hands a runtime's
  `_session/closed` (a deliberate close, never a disconnect) to auto-archive.
- `src/inbound/kafka.rs`: trigger ingestion.
- `src/domain/mode_choice.rs` + `src/inbound/mode_choice.rs`: the agent
  composer's Auto mode, `POST /agent-mode-choice`, which asks Clef Flash
  (`jev`) whether a prompt goes to a chat or a coding agent.

## Scope

- Owns: session lifecycle orchestration, container provisioning, runtime
  selection, MCP/tool-approval wiring for sandboxed sessions.
- Not here: session state/persistence → `agent_session`; credential
  stamping for sandbox egress → `agent_egress`; the ACP wire protocol →
  `agent_runtime_protocol`.

## Boundaries

- Depends on: `agent_session`, `agent_egress`, `agent_runtime_protocol`,
  `agent_trigger`, `ai_billing`, `jev`.
- Used by: `agent_harness_service` (its sole host).

## Recipes

- Add a new runtime: `src/domain/<runtime>.rs` (session setup) →
  `src/outbound/<runtime>.rs` (adapter) → `src/domain/service.rs` (dispatch)
  → `src/inbound/capability_discovery.rs` if it needs discovery.
- Add a trigger source: `crates/agent_trigger` (context) →
  `src/domain/trigger_router.rs` → `src/inbound/kafka.rs`.

External runtimes receive the session's configured MCP selection when binding,
including enabled owner connections and custom servers under `OwnerConnections`.
Under `Selected`, an overlaid app (`pipedream_mcp` `mcp_overlays`) the owner
authorized natively is advertised as that custom server instead of its slug;
an app connected that way also satisfies the `app.connected` resume check.
Use `external_mcp_servers` to preserve the host-reachable egress URL override.

External chat replies use `domain/service/external_replies.rs` and the
`agent_external_replies` journal. Macrod sends the triggering message ID as the
control action ID; the harness joins that completion to its authorized reply
origin, regardless of arrival order. Recovery reads terminal results from the
original durable action history when an observer callback was lost, including
turns hidden by a later session load, and retries message updates
without re-prompting. Keep deduplication inside the serialized command worker.
Remember successful announcements. After 24 hours, recover replies without a
persisted completion at most hourly, preserving late answers after lost callbacks.
Persisted completions bypass this backoff; direct completion handling is immediate.

Prompts to an external runtime pass `authorize_runtime` when accepted and
`runtime_refusal` again when they dispatch, so a prompt queued before access was
removed never runs: `RuntimeAccessFacts::may_run` requires a coding agent's
prompter to have access and a resident's (a bound non-coding agent's) owner to
have access (`agent_owner_can_run` in SQL), so removing access shuts a resident
down without touching its binding. A turn nobody prompted runs on the agent
owner's access. A refused prompt fails its conversation turn, publishes
`command_rejected` with code `no_runtime_access`, and posts the reason into the
conversation it came from as a `ReplyOutcome::Refused` reply under an id derived
from the action, so redelivery finds the same message. The session API answers
it with a 403 whose JSON `code` is `no_runtime_access`.

External runtimes bind sessions lazily. On each dial `RuntimeRegistry` has the
connection run `initialize` (shared with every session through its handshake)
and ACP `session/list`, and `AgentHarnessService::reattach_live_sessions` runs
`HarnessCommand::Reattach` for the listed sessions bound to that harness,
restoring each (`session/load` or `session/resume`) without a prompt, then
dispatching whatever its durable queue still holds when no turn is running;
attached, archived and managed sessions are skipped. A dial restores only sessions
with a command in flight here, an unfinished turn (`has_unfinished_turn`: open, or
open when the session disconnected, from `agent_session.turn_interrupted`), a
durable queue, or activity in the last hour (`modified_at`, or the listing's
`updatedAt`); idle ones bind on their next prompt or delivery
(`service/reattach.rs`). Every dial on a replica shares `REATTACH_CONCURRENCY`
permits, each held until the session's `session/load` or `session/resume`
finishes; a harness dialing again stops its previous dial from starting more.
Permanent errors are not retried; others are, with jittered backoff, while the
runtime stays connected. A session whose load keeps failing stays disconnected
with its turn unfinished, so every dial tries it again (three attempts, under a
permit). The `agent.runtime.reattach` span counts eager, lazy,
skipped, failed and abandoned sessions and retries. macrod's herdr-acp lists
native sessions whose Herdr agent still runs, each with `updatedAt` from its
transcript's last write, so a session worked on in its Herdr pane within the
hour is restored at dial time.

Each session's commands run one at a time on its command worker
(`service/queue.rs`). A worker exits after `WORKER_IDLE_TIMEOUT` with nothing
queued, and with the session it deletes, removing its map entry through
`retire_worker`; commands are sent under the same entry lock, so one racing
the exit either keeps the worker or starts a new one. Before an idle worker
retires, `service/idle.rs` silently releases a quiet session (nothing admitted
in `busy`, empty queue, no notification batch) whose runtime says the release
is lossless (`ContainerManager::idle_release_is_lossless`: the in-process
manager compares its live state with what the log rebuilds). An in-process
session's actor attached here goes through
`AgentSessionService::release_session`, never `close_session`: no
`disconnected` frame, no `SessionStopped`, no lifecycle event or webhook, its
claim given back under its own fence. Then `ContainerManager::release_idle`
drops this process's runtime state, and the queue copy and `hydrated` mark are
forgotten. The next command finds no actor and resumes from the log. Unclaimed
warm sessions never get a worker, so they stay warm.

Durable system events use the `agent_session` outbox, distinct from the user
push notifications planned in `domain/notifications.rs`. The serialized session
worker drains waking batches after a turn; quiet batches join a real prompt.
Recovery reconciles the original action before rebinding/retrying, preserves
prompter authority, and waits for a running invocation instead of re-prompting.
Attach notifications before claiming the conversation journal, so a recovered
running batch leaves the next real message queued. Recovery retains one drain
future per session and waits at most two seconds per sweep; lease renewals and
other sessions continue after a slow drain or an individual renewal error.
Keep duplicate-completion suppression bounded to recent actions.
Advance the bounded discovery cursor even when a session is busy or unreachable;
wrap after its final page so those sessions cannot starve later ones.
Reconcile active leases against terminal log evidence too: an observer can miss a
completion during takeover. Previously bound quiet attempts reconcile before new
wakes; interrupted quiet batches return to the next real prompt.

Each dial costs a replica a handshake, `session/list` and a reattach, so
`inbound/runtime_gateway.rs` gives every authenticated harness a per-replica,
in-memory `DialBudget` (6 dials a minute, as a burst or one every 10 s) and
refuses the rest before the upgrade with `429` and `Retry-After`. Refusals warn
and set `agent.runtime.dial_outcome:rate_limited` on the `agent.runtime.dial`
span. macrod treats a 429 as retryable on its own exponential backoff
(1 s doubling to 30 s) and does not read `Retry-After`.

Harness presence is per connection, because a runtime's redial can land on a
different replica than the socket it replaced, and a stalled replica can notice
that socket's end long after. `RuntimeRegistry` mints a `RuntimeConnectionId` per
dial and reports it to `HarnessPresence`; a close removes only its own row, and
each replica renews the leases of what it holds, so a crash reads offline within
the lease. To debug a harness in Datadog, search `@harness:<id>` for
`@telemetry_event:(harness_runtime_connected OR harness_runtime_disconnected OR
harness_runtime_lease_restored)`: each carries `connection` and `replica`, and a
disconnect's `other_live_connections` above 0 is a stale close that changed nothing.

## Checks

- `cargo nextest run -p agent_harness --lib --test-threads=2` (`SQLX_OFFLINE`
  unset). Use CI's process isolation for the full database-backed suite so each
  test has its own process and runtime.

## Gotchas

- A session's first prompt carries static files from the mentioning message
  and the rest of its thread (mention first, then root and replies), capped
  at 8 and deduped by file id; follow-ups carry only their own files.
  Background channel messages are not attached. `trigger_router` fills each
  context attachment's `url` from `StaticFileLinks`, and `<m-agent-context>`
  lists them per message; ACP `resource_link`s are what vision models fetch.
- Every composed prompt's `<m-agent-context>` states `<current_time>` in the
  sender's (else owner's) primary calendar time zone, via the
  `UserTimeZones` port, or UTC when unknown. Models have no other source
  for the date, so never drop it from a composition path.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
