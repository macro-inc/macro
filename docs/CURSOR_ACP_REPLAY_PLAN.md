# Cursor ACP durable replay plan

## Agreed behavior

- Cursor advertises ACP load support, not resume support. The generic session framework already prefers resume and falls back to load. Do not add a restore-strategy column.
- Cursor owns a durable journal of provider-native inputs. Loading a session pumps those inputs through the same Cursor-to-ACP state machine used live, reconstructing the whole conversation before returning the load response.
- `agent_session_log` remains an append-only record of all ACP frames. Replayed history is intentionally stored again; do not add per-event ACP projection deduplication.
- The product history read selects the initialization preceding the latest successfully completed load, through the present; with no successful load, start at the beginning. Earlier copies remain available as raw audit history.
- Keep `AgentSessionLogRepo::list_by_session` as the history interface, documenting its new meaning as effective ACP history rather than every stored row. Cache the selected boundary in nullable `agent_session.history_start_log_id`; do not scan protocol JSON to rediscover it on every GET.
- Live projections, server refolds, and browser history must agree on that selected window. A resume does not replace history.

## Boundaries

- `cursor_cloud_agents` domain owns capture/replay policy, journal models and ports, Cursor translation, and provider ingestion progress. Its PostgreSQL adapter implements storage; the service composition root supplies it.
- `agent_session` owns raw ACP logging, connection/request correlation, and the selected history boundary.
- `agent_fold` remains provider-neutral. It understands generic load/replay lifecycle only where necessary to keep streaming projections consistent.
- Existing session authorization remains at the session access boundary. Journal reads must be scoped to the authorized session; raw provider payloads are not a new public endpoint.

## 1. Define the durable Cursor journal

Introduce Cursor-owned run/input storage, linked to the existing session/provider identity rather than inventing a second mapping.

Store:

- Run identity and ordered session/run membership.
- Original user prompt/content and its association with the run, including prompts originating on cursor.com where available.
- Ordered complete SSE records: event name, original data text, and provider event ID when present. Preserve unknown records; do not store TCP chunk boundaries as the semantic unit.
- Other replay inputs used by the live path: polling responses, run completion/cancellation/error facts, and any state-machine inputs that generate synthetic terminal updates.
- Durable capture progress, distinguishing a partially captured run from a fully reconciled run.

Use explicit sequence ordering rather than timestamps alone. Keep raw inputs; do not additionally store a second canonical ACP transcript in the Cursor journal. Replaying with the current translator is acceptable for this change; pin representative behavior with fixtures.

The existing delivered-run watermark and a journal ingestion checkpoint have different meanings. During migration, preserve the existing fenced append/checkpoint guarantee. Replace it only once journal-backed recovery covers the same crash windows; do not repurpose or advance it early.

## 2. Capture before translation and delivery

- Add journal ports to the Cursor service and inject the PostgreSQL implementation through the existing harness/service composition.
- Persist inputs before processing them into ACP notifications. A failed append must not silently advance capture progress or publish unjournaled output.
- Route SSE, polling fallback, and foreign-run recovery through one ordered journal/processing path. Replay never calls the provider to execute a prompt or tool again.
- Preserve single-writer ordering across prompts, polling, background synchronization, and load. Protect journal writes from stale owners using the existing ownership/fencing model or an equivalent explicit journal contract.
- Define reconnect reconciliation using provider IDs only where actually supported. A local sequence is not a remote resume token. Do not assume Cursor accepts SSE `Last-Event-ID` without verifying it.
- Handle partial streams and overlapping polling results without appending duplicate provider content to the logical journal. This is ingestion reconciliation, not ACP-log deduplication.

## 3. Implement complete ACP load replay

Primary targets: `crates/cursor_cloud_agents/src/domain/service.rs`, `domain/translate.rs`, `inbound/acp.rs`, `api.rs`, and `replay.rs`.

1. Resolve the persisted Cursor session and capture a stable journal high-water mark while serializing load against live emission.
2. Create fresh translation state and replay prompts, provider records, and run lifecycle inputs in order through that mark.
3. Emit user messages, assistant/thought content, tool calls, tool results, and terminal tool updates. Share the live processing logic rather than implementing a separate approximate translator.
4. Retain the reconstructed translator/session state for continuation. Do not mutate remote Cursor state during replay.
5. Queue `LoadSessionResponse` only after replay notifications, then enable background synchronization/live continuation. New inputs beyond the replay high-water mark must be emitted after that response.
6. A failed replay does not report successful load or enable readiness.

Raw SSE replay helpers already exist, but `TranslateMachine::push` alone is insufficient: it ignores user messages and lifecycle events that the session service handles separately. Extract/share only the processing necessary for equivalent live and replay output.

Existing sessions without a journal need an explicit compatibility path: attempt provider-history hydration and record the available inputs before replay. If full reconstruction is unavailable, preserve the existing Macro history and return an explicit load failure rather than successfully selecting an incomplete replacement. Document any backfill limitations before rollout.

## 4. Track successful replay history boundaries

Primary targets: `crates/agent_session/src/domain/session/session.rs`, `domain/session/types.rs`, `domain/ports.rs`, and `outbound/postgres.rs`.

- Continue storing every request, notification, response, and system frame.
- Associate each load attempt with its session, connection/initialization context, request ID, and ordered starting boundary. JSON-RPC IDs alone are not globally unique.
- Publish a new history boundary only when its matching successful load response is durable. Couple boundary advancement to the fenced persistence path so stale actors cannot select a new history.
- Add nullable `agent_session.history_start_log_id`, referencing the initialization row in `agent_session_log`. This is a history boundary, not a restore strategy. Existing sessions begin with `NULL`.
- Product history starts at the relevant initialization boundary, not at the load response: the preceding replay updates must be included.
- Keep `AgentSessionLogRepo::list_by_session` rather than introducing `history_by_session`. Change its documentation from all entries to effective ACP history and audit its callers. Complete raw history remains stored and available through explicit diagnostic SQL; do not add another public endpoint or repository method without a concrete consumer.

### Boundary write path

1. When initialization is persisted, retain its stored log row ID and connection context. Plumb the durable row identity through the writer/actor result where necessary.
2. Associate a subsequent `session/load` request with that initialization and request ID. For shared transports, explicitly establish the relevant initialization in each session's log; do not assume the nearest unrelated row is suitable.
3. Append all replay notifications normally, including duplicate conversation content.
4. On the matching successful load response, atomically append the response and update `history_start_log_id` to the associated initialization row, under the current ownership fence. The domain session machine identifies the successful load and passes a typed boundary update to persistence; the SQL adapter must not infer protocol policy from JSON.
5. Failed/interrupted loads, `initialize` alone, `session/new`, and `session/resume` leave the pointer unchanged. A crash cannot commit the pointer without its successful response, or vice versa.

Enforce that the boundary belongs to the same session, including in the atomic update's predicates. Account for the session/log foreign-key cycle in deletion behavior: deleting a session must still remove its logs safely. Boundary selection must use the same deterministic `(created_at, id)` order as the log reader.

### History read path

The existing call chain remains:

```text
GET /agent-sessions/{session_id}/log
  -> AgentSessionService::session_log
  -> AgentSessionLogRepo::list_by_session
  -> PgAgentSessionRepo
```

Illustrative range query (retain the existing SQLx field/type annotations in the implementation):

```sql
SELECT
    log.agent_session_id,
    log.user_id,
    log.direction,
    log.content,
    log.created_at
FROM agent_session_log AS log
JOIN agent_session AS session
    ON session.id = log.agent_session_id
LEFT JOIN agent_session_log AS boundary
    ON boundary.id = session.history_start_log_id
   AND boundary.agent_session_id = session.id
WHERE log.agent_session_id = $1
  AND (
      boundary.id IS NULL
      OR (log.created_at, log.id) >= (boundary.created_at, boundary.id)
  )
ORDER BY log.created_at, log.id;
```

Reuse or add an index on `agent_session_log (agent_session_id, created_at, id)`. Verify with `EXPLAIN ANALYZE` that the nullable-boundary predicate produces an efficient plan; split null/non-null query paths if necessary rather than assuming the index guarantees a range scan. The boundary lookup uses the log primary key.

This query never reads the Cursor journal: Cursor load has already translated that journal into the stored ACP frames. Update the endpoint's current "whole log from the beginning" documentation to describe the selected window.

Failed or abandoned replay attempts must not appear as new conversation content in the selected history. Retaining the prior boundary alone is insufficient because partial replay frames lie after it. The range query intentionally returns these raw frames too; the generic load-attempt staging semantics below must prevent them from becoming committed conversation content during both batch and live folding. Do not describe the pointer as solving partial-replay handling by itself.

## 5. Align every fold consumer

Primary targets: `crates/agent_session/src/domain/service.rs`, session history endpoint/realtime integration, and `crates/agent_fold/src/domain/fold.rs` plus its log repository consumers.

- Route server refolds and product history GET through the same selected-history contract.
- During an in-flight load, retain the last committed visible conversation and stage reconstructed history separately.
- On successful load, replace the active projection with the reconstructed one; on failure/disconnection, discard the candidate. Never fold replay text into the old conversation as new activity.
- Ensure browser consumers receive a reset/replacement boundary or implement equivalent generic load lifecycle handling. The wire stream can still contain all frames; snapshot plus streaming must produce the same visible state.
- Do not reset on `initialize`, `session/new`, or `session/resume` alone.
- Update the relevant `docs/AGENT_GUIDE/` entry if externally visible reconnection behavior changes.

## 6. Verification and rollout

Unit/fixture tests:

- Multi-turn raw capture reconstructs prompts, thoughts, messages, tool inputs/results, and terminal states in order.
- Live and journal replay produce equivalent normalized ACP content for SSE, polling fallback, foreign runs, cancellation, and interrupted streams.
- Loading repeatedly never re-executes provider actions; reconstructed state supports the next live turn.
- Generic restore negotiation still prefers resume; Cursor still selects load without a strategy column.
- Two successful loads grow the raw log but display one conversation. GET, server fold, and browser incremental fold agree.
- Failed/interrupted load preserves prior visible history without exposing partial duplicate replay. Resume preserves history. Reused request IDs and shared connections cannot select another session's boundary.

Database/restart tests:

- Journal append failure, stale owner writes, and crashes before/after capture, ACP append, and load-response persistence preserve recoverability.
- Partial-run recovery reconciles overlapping provider inputs; completed runs are not ingested again.
- History boundary selection uses its intended index and deterministic order.
- A `NULL` boundary returns from the beginning; successful load moves the pointer to initialization (not the response); failed loads and resume do not move it. Test session deletion and rejection of cross-session/stale-owner boundary updates.
- Boundary advancement and load-response append commit or roll back together. Test history reads across that transaction and the existing `list_by_session` callers under its new contract.

Generate migrations with `sqlx migrate add` in the relevant database crate. After SQL changes, run `nix develop --command just prepare_db` from the repository root; never hand-edit SQLx metadata.

Run affected crate tests individually with `SQLX_OFFLINE` unset: `cargo test -p cursor_cloud_agents`, `cargo test -p agent_session`, `cargo test -p agent_fold`, and `cargo test -p agent_harness`. Run `cargo check -p agent_harness_service`, formatting, and targeted Clippy. Bring up the supported local database environment before DB-backed tests.

End-to-end: create a multi-turn Cursor session with tools, restart the harness, observe full replay before the load response, confirm the raw log grew while the UI shows one copy, then complete a new prompt. Repeat a restart during replay and during a partially captured run.

## Non-goals

- No provider-specific logic in the generic fold.
- No ACP-frame deduplication or deletion of old raw log copies.
- No restore-strategy database column.
- No unrelated harness refactor or new public raw-provider-history API.


## Persisted legacy load rollout

`agent_session_log.legacy_load` is read interpretation context outside the raw
ACP envelope. Migration `20260906042344_agent_session_legacy_load_context` marks
only already-persisted `session/load` requests belonging to external Cursor
sessions, whose old adapter acknowledged loads without replay. Their matched
success retains the committed conversation. The fold checks only this generic
per-attempt context, never a provider identity or proprietary response marker.
All new rows default to `false`: a valid standard ACP load success replaces the
conversation, even with zero replay messages. Failed new hydration retains old
history and quarantines partial replay as usual. GET exposes the optional
`legacyLoad` context to the same WASM fold used by browser streaming; raw
`content` remains unchanged and every audit row remains stored.

Stop/drain old Cursor writers before applying this migration, then start the
journal/replay-capable adapter and updated session/fold/browser consumers. An old
writer left running after the migration could still acknowledge a no-replay load
that is correctly interpreted as standard by new consumers. This is a coordinated
cutover, not a mixed-version rolling deployment. Historical Cursor sessions must
have their existing `external_agent_session` mapping intact for the migration to
identify their pre-rollout requests. New hydration failures remain explicit load
failures; they do not grant legacy eligibility to new attempts.
