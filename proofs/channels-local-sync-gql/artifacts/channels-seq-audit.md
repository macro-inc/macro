# Channel GraphQL sequence integration audit

Reviewed `e19d14d79a2b38eed19f38a0716ea616e4c6c6d2..fe958645209323b3ec9b8f5951397e9f12c3f570`.
Only the intentionally uncommitted `REPORT.md` remains. No source correctness defect found. This
review supersedes the earlier zero-sequence-seam deferral: the GraphQL adapter
now calls the reviewed sequence domain reads.

| Result | Check | Evidence |
| --- | --- | --- |
| fail, delegated | Offline Rust typecheck / SQLx metadata | `/tmp/channels-seq-rust-check.log`: six missing query-cache entries and six resulting inference diagnostics. Parent owns `just prepare_db`; this worker made no cache changes. |
| skipped | Clippy / remaining Rust-validation sequence | Required stop after failed `just rust-check`; rerun after parent metadata generation. |
| pass | Final composed replay and schema tests | `/tmp/channels-complete-graph-seq-final.log`: 119 passed, zero failed, one opt-in performance test ignored. All five new sequence/replay tests passed, including the final reply-only-log assertions; binary/doc tests also passed. |
| pass | GraphQL adapter tests and SDL regeneration | `/tmp/channels-graphql-channel-seq-final.log`: 2 passed; `/tmp/channels-sdl-seq-final.log`: SDL regenerated, with no resulting committed-schema difference. |
| pass with accepted limitation | Real-sequence latest-page performance | Three optimized runs passed. Consecutive no-build repeats: GraphQL median/p95 2.261/2.557 ms and 2.217/2.879 ms; REST 1.391/1.708 ms and 1.400/1.900 ms. Additional median cost 0.870/0.816 ms; domain reads effectively equal. Exactly 10 GraphQL SQL statements versus 9 REST, differing only by the first counter SELECT. `/tmp/channels-gql-real-seq-perf-report.md`. This remains overhead, not literal equal latency; the accepted limitation is stated explicitly. |
| pass | Other five dependent fixture crates after rebase | `/tmp/channels-post-seq-fixture-crates-test.log`: agent_trigger 180, bots 129, channel_bots 45, scheduled_action 462 unit + 6 integration passed. Harness compile passed and `/tmp/channels-post-seq-agent-harness-nextest.log` reports 559/559 passed, zero skipped. |
| skipped | Real served HTTP/WebSocket trace in Tempo | Running stack was not modified or restarted. In-process spans and schema execution do not replace this check. |
| pass | Rebased messages suite | `/tmp/channels-seq-messages-test-final.log`: 196 passed, zero failed, two opt-in performance tests ignored; `SQLX_OFFLINE` unset. |
| pass | Rebased channels/documents/DSS suites | `/tmp/channels-seq-downstream-test.log`, exit 0: channels 387, documents 541, DSS 98 passed, zero failed or ignored; binary/doc tests also passed. Used disposable PostgreSQL 35432, empty per-command compiler wrapper, and the real Nix code-mode asset bundle. |
| pass | Static formatting/rules/schema compatibility | Final `/tmp/channels-seq-check-complete.log`: `just check` passed against sequence base `e19d14...`; `git diff --check` also passed in this review. |
| pass, parent verified | Dependency metadata and commit privacy | Parent reports `cargo x deps --check` and privacy checks passed; generated dependency closure reflects the inherited channel-change utility. |
| pass | Rebase conflict resolution | `git range-diff` confirms the reviewed sequence modules, shared assembler, transaction-aware root hydration, and channel write hydration survive. New reply ordering is added at the shared `assemble_message`, not only the removed pre-rebase bulk hydration code. No conflict markers found. |
| pass | Import order / wire compatibility | `StoredMessage.import_order` reaches `Message.import_order` through the shared assembler used by reads, writes, and replay. REST serde/OpenAPI/JSON Schema still omit this internal field. Timeline/thread sort keys retain the agreed format and assumptions. |
| pass | Sequence before both page reads | `user_query.rs` authorizes, awaits `channel_seq(channel_id)`, then calls `timeline_entries` or `thread_page`. No concurrent launch or later watermark read. Passing composed test `channel_page_watermarks_are_read_before_page_queries` explicitly sequences mock expectations; real SQL inventory also confirms counter lookup precedes page statements. |
| pass | Change-page projection | `reads.rs` forwards the domain's reset flag, reached sequence, has-more flag, removed IDs, current roots with thread/call metadata, current replies, and activities. Mapping issues no additional per-item reads. Timeline/change activity mapping now shares one function. |
| pass | Authorization and architecture | Viewer comes from authenticated `GraphqlUser`; channel view receipt is minted before sequence/page calls. `channel_changes` forwards receipt and matching channel ID to the domain, which checks their match. Primary-backed REST service remains shared by HTTP and WebSocket request data. Domain owns parent/thread policy; outbound adapters own SQL. |
| pass | Contract shape / scope | No changes to agreed field names, nullability, IDs, cursor meanings, page bounds, or message type identity. No `apps/web` changes and no new migration in this diff. |

New composed replay coverage, inspected and passing in the final suite:

- `channel_changes_match_domain_current_states_tombstones_and_removed_ids`
  compares every selected field against the domain read and checks changed
  replies/root coalescing, deleted roots/threads/replies, reactions,
  attachments, bot profile, all call states, activities, and hard-deleted or
  out-of-channel IDs. Final reply-only log cases prove the live or tombstoned
  reply's root is returned even without a root log row, including a deleted
  thread's root.
- `channel_changes_page_200_log_rows_and_hydrate_each_id_once` walks 450 log
  rows as 200/200/50 and verifies current IDs are coalesced.
- `channel_changes_reset_for_pruned_future_reset_and_lagged_cursors` covers
  retention floor boundaries, empty retained history, future cursors,
  1,000/1,001 lag, and a reset beyond the first 200 log rows.
- `channel_changes_validate_sequences_and_preserve_access_scope` covers bad
  decimal cursors, access denial, and an authorized empty channel.

Database caller review:

| Severity | New caller / preserved query | Bound and evidence |
| --- | --- | --- |
| note | Page watermark | `current_seq` is a single `channel_change_counters` primary-key lookup; no write or row lock. It runs once before each timeline/thread page. |
| note | Changes log | Reviewed sequence-base `read_log` remains unchanged: one statement reads counter/floor/log consistently; `(channel_id, seq)` primary key, ordered maximum 1,001 rows; domain applies 1,000-lag reset and 200-row pages. Read transaction has a 15 s local timeout. |
| note | Change message/root hydration | Reviewed base path remains unchanged: at most 200 logged message IDs, same-channel message/root guards before hydration, repeatable-read read-only transaction, batched root/previews/references and call statuses. Root live-reply counting still scales with that root's reply count. |
| note | Activity replay | Reviewed base path uses typed activity ID lookup with same channel and selected action vocabulary; at most 200 logged IDs, no client filtering. |
| note | Shared message assembler | Added only assignment of `row.import_order`; no new SQL or change to commit/append ordering. |
| note, previously accepted | Thread scale and timeline timeout | Prior no-new-index decision remains: the 100k imported-thread edge and live-reply counts scale with thread size. Timeline older/newer retain their pre-existing lack of query-local timeout. See `/tmp/channels-domain-query-report.md`; these behaviors were not altered by integration. |

The final benchmark uses a verified private copy of the 50,000-message seed,
the real sequence service returning `"1"`, and read-only benchmark sessions.
The first run overlapped compilation; both consecutive repeat results above
are retained. Authorization uses the test harness and transport is excluded.
The real counter lookup costs about 0.053–0.054 ms median; it adds one bounded
query, with no per-entry queries. Full offline validation, final metadata, and
the real served trace remain integration-owner work. No worker cache edits or
shared-stack mutations were performed.

The final small fixture change was reviewed: two synthetic channel-bot
`MessageEvent` literals add `seq: None`, and the current-state replay test adds
reply-only-log root-inference assertions. It changes no production behavior.

An inherited documentation issue remains: `crates/messages/AGENTS.md` links
`proofs/README.md`, but `crates/messages/proofs/README.md` does not exist. The
coordinator identified this as a sequence-parent-owned issue; no edit made here.
