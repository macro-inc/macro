# Channel GraphQL read audit

Reviewed branch `synoet/channels-local-sync-gql` at `6c12707d5a`, against
`354da677b583944daaa99e84f231fc0909cea990`, including all implementation,
composition, generated SDL, and dependent fixture commits. Only the intentionally
uncommitted `REPORT.md` remains outside the commits. No open source correctness
finding remains after the service dependency and fixture fixes.

The work is ready for the coordinating branch's remaining integration work, not
for a claim that the original full contract and offline validation are complete.

| Result | Check | Source | Evidence |
| --- | --- | --- | --- |
| fail, explicitly deferred | `just rust-check` | Rust validation skill | `/tmp/channels-rust-check-clean.log`: six absent offline SQLx entries at `thread.rs:10,38,170,187` and `timeline.rs:168,193`, followed by six inference-error cascades. All affected queries compile against the live scratch database in the passing tests. |
| skipped, explicitly delegated | Generate and commit SQLx metadata | Parent decision #529 | The coordinating integration branch owns `just prepare_db`; no regeneration or restoration is authorized here. It must land before offline workspace validation can pass. |
| skipped | `just clippy`, then `just format`/`just hakari` validation sequence | Rust validation skill | The skill requires stopping after failed `just rust-check`. Resume its full sequence after the coordinating branch generates metadata. Changed-file format checks and the separate dependency check passed below. |
| skipped, explicitly deferred | Real sequence reads and `channelChanges` replay | Parent decision #539 | The single clearly marked seam in `graphql_channel/src/reads.rs` intentionally still returns sequence zero. Sequence-branch integration, replay tests, and the final sequence-query cost remain outstanding. |
| skipped | Running DSS HTTP/WebSocket request and connected Tempo trace | Observability rule; stack constraints | No stack start/stop/rebuild was performed. Composed-schema execution, actual repository SQL, and local tracing measurements passed; a deployed HTTP/Tempo trace was not verified. |
| pass | `just check` at final head | Root guide | `/tmp/channels-just-check-final.log`, exit 0: formatting, repository rules, SDL compatibility, dependency warnings, and added-line PII scan. Existing shear warnings are non-failing. |
| pass | `cargo x deps --check` at final head | Cargo changes | `/tmp/channels-deps-final.log`, exit 0. No workspace-hack or dependency-closure changes required. |
| pass | `just pr-privacy` at final head | Git skill | `/tmp/channels-privacy-final.log`: no personal or support-channel details. Commit titles and changed comments/fixtures were also reviewed. |
| pass | Whitespace, source scope, commits | Root guide | `git diff --check` clean; no `apps/web` changes or new migrations; five small Conventional Commit commits, including the fixture changes. |
| pass | `cargo test -p messages --all-features` | Messages guide | 176 passed, zero failed; `/tmp/channels-messages-final-test.log`. |
| pass | `cargo test -p graphql_channel` | Adapter guide | 2 passed, zero failed; `/tmp/channels-gql-unit-final.log`. |
| pass | `cargo test --release -p complete_graph` | Composed-schema guide | 114 passed, zero failed, one opt-in performance test ignored; `/tmp/channels-complete-graph-final.log` is explicitly labeled saved transcript excerpts. The ignored performance test passed separately. |
| pass | `cargo test -p channels -p documents --all-features` | Both crate guides | 387 channels tests and 541 documents tests passed; `/tmp/channels-downstream-test-final.log`. Binary/doc tests also passed. |
| pass | `cargo test -p document_storage_service` | DSS guide | 92 passed, zero failed; `/tmp/channels-dss-test-final.log`. This caught and then verified the missing direct `graphql_channel` dependency fix. |
| pass | Additional dependent fixture crates | Their guides | `/tmp/channels-fixture-crates-test.log`: agent_trigger 180, bots 129, channel_bots 45, scheduled_action 462 unit + 6 integration, all passed. |
| pass | Agent harness process-isolated tests | Agent harness guide | `cargo test -p agent_harness --no-run` passed; `cargo nextest run -p agent_harness --lib --test-threads=2 --no-fail-fast` passed 559/559, zero skipped; `/tmp/channels-agent-harness-{compile,nextest}.log`. |
| pass | Live SQLx validation for all tests | Root/database guides | Every test command leaves `SQLX_OFFLINE` unset and connects only to the disposable scratch PostgreSQL instance; no production or seeded-stack writes. |
| pass | SDL generation and compatibility | GraphQL field guide | Generated `static_assets/schema.graphql`; both committed-SDL and field-contract tests pass, and final `just check` reports compatibility with the base. Input fields, output fields, nullability, enum/union shapes, and IDs match contract section 2. |
| pass | REST parity, ordering, and access | User proof requirement | Composed tests `channel_timeline_matches_rest_every_page_and_around_window`, `channel_thread_pages_match_rest_and_sort_keys_follow_import_order`, `channel_single_message_matches_rest_and_respects_channel_access` pass. The rich fixture covers roots/replies/tombstones/deleted thread/import orders/reactions/attachments/mentions/bot/activity/all call states, both traversal directions, around windows, every returned field (including nullable `guestName`), has-more cursors, and access denial. Guest senders are permitted only on call parents, so this channel fixture does not contain one. |
| pass | Independent old/new SQL regression | User proof requirement | `timeline_keyset_rewrite_matches_previous_sql_selection` preserves old SQL and compares selection/order/has-more across both parents/directions/cursors/tombstones. Twelve seeded SELECT-only full-record comparisons also report zero differing rows in `/tmp/channels-sql-parity.txt`. |
| pass with accepted limitation | Latest-page performance | Parent acceptance #543 | Optimized 200 paired samples: GraphQL median 2.370 ms/p95 2.666 ms; REST 1.671/1.875 ms. Added 0.699 ms is GraphQL execution overhead; actual domain reads 1.581 vs 1.590 ms and exactly nine identical SQL templates. The original literal no-slower target is unmet and explicitly accepted; `/tmp/channels-gql-perf-report.md`, `/tmp/channels-perf-release.log`. Final sequence query and production authentication are not included. |
| pass | Hexagonal boundaries and primary reads | Architecture skill; contract | The adapter mints the same `MessageView` capability as REST and calls domain APIs. Parent/thread lifecycle policy remains in `MessageService`; SQL/hydration remain in `PgMessageRepository`. DSS injects the same primary-backed message service into HTTP and WebSocket request data. No SQL or permission policy moved into GraphQL. |
| pass | Instrumentation source review | Observability rule | New read operation spans carry channel/root/message IDs and page counts without message content. Timeline phases are measured separately. Thread page queries have their own operation span. |

## Database review

Evidence is from local databases only. The seeded `channels` instance was used
only for SELECT/EXPLAIN. Thread-scale fixtures were created in disposable
databases. Exact SQL/plans and environment details are recorded in
`/tmp/channels-domain-query-report.md`, `/tmp/channels-final-query-plans.txt`,
and the referenced thread-scale plan files. No migration or new index ships.

| Severity | Query / caller | Rows and index or bound | Evidence and disposition |
| --- | --- | --- | --- |
| note, accepted #522 | New thread older/newer/latest selections, including imported and ordinary buckets | `idx_comms_messages_thread_order`; scope/live checks precede each branch LIMIT; at most two active branches, then bounded merge and primary-key hydration. Some stale plans scan the imported portion before finding ordinary replies. | Measured all branches at 50, 1,000 and 100,250 replies. At 1,000: repeated latest 0.334/0.274 ms, older 0.350/0.324 ms, newer 0.250/0.261 ms (custom/generic). At 100,250, latest/newer filter 100,200 imported rows and take about 10–11 ms. Parent explicitly accepted that edge with no index/planner-setting change. Selection transaction has local 15 s statement timeout. No claim of depth-independent thread work. |
| note, accepted #522 | Root thread state/count/latest-reply hydration, now also called by page/item reads | One root state via `comms_message_threads_pkey`; live count through `idx_comms_messages_thread_active_created`, scaling with replies in that root; latest-reply lookup uses the same timestamp index. | Measured count/max 0.152/0.219 ms at 1,000 and 15.757/14.758 ms at 100,250 replies. Cost predates the new page API but repeats per new page; explicitly accepted. This metadata hydration is outside the selection transaction's local timeout. |
| note | Timeline older | `idx_comms_messages_parent_timeline`, equality on parent and row-comparison seek; correlated live-reply probe uses `idx_comms_messages_thread_active_created`, thread join uses primary key. | Measured depth 32,000 on 50,000-message channel: repeated custom 10.085→0.268 ms, generic 4.789→0.220 ms. Cursor now in Index Cond; old whole-live-table hash eliminated. No query-local timeout is added: existing timeline timeout behavior is unchanged. |
| note | Timeline newer | Same parent timeline index and live-reply/thread lookup indexes. | Repeated custom 0.215→0.223 ms, generic 1.465→0.218 ms; cursor in Index Cond. Existing query-local timeout behavior unchanged. |
| note | New exact root lookup | `comms_messages_pkey`, then parent/root predicates; at most one root. | Index-checked; bounded exact lookup, shared hydration below. |
| note | New around-thread anchor lookup | `comms_messages_pkey`, then parent/thread/live predicates; at most one anchor. | Index-checked; inside selection transaction with local 15 s timeout. |
| note | Existing root preview, new caller | `idx_comms_messages_thread_order`, per-root LIMIT 3. | Measured at all three thread sizes; repeated 100,250-reply preview 0.043/0.035 ms custom/generic. Root-scoped, not a whole-channel scan. |
| note | Existing channel-parent existence lookup, new GraphQL caller | Channel primary key, one row. | Same query and inputs as REST; index-checked and included in nine-template latest-page comparison. |
| note | Existing thread access/state lookup, new thread/item callers | Root state primary key plus parent checks, one row. | Same live-thread policy as REST; index-checked. |
| note | Existing message lookup, new item caller | `comms_messages_pkey`, one row, parent check. | Same REST domain call. Root item then loads contextual root state; bounded extra work, no per-list-entry resolver loop. |
| note | Existing activity timeline query, new GraphQL caller | Existing activity timeline index and page limit; same server-side selected action vocabulary and cursor as REST. | Same real domain read and identical SQL template verified by latest-page comparison. No widened scope or client filtering. |
| note | Existing attachment hydration, new bounded-page callers | `idx_comms_attachments_message_id`; batch of selected root/reply/preview IDs, sort only the matching attachment rows. | Same REST hydration path and SQL template; no per-message query loop. |
| note | Existing reaction hydration, new bounded-page callers | `comms_reactions_pkey(message_id, emoji, user_id)`; aggregate only reactions for selected IDs. | Same REST hydration path and SQL template; no widened tenant scan. |
| note | Existing mention hydration, new bounded-page callers | `idx_comms_entity_mentions_source` / leading columns of `idx_comms_entity_mentions_combination`; source type plus selected source IDs. | Same REST hydration path and SQL template; bounded by selected messages' references. |
| note | Existing bot profile hydration, new bounded-page callers | Bot primary key with selected sender IDs. | Same REST hydration path and SQL template; one batch. |
| note | Existing call-status hydration, new root/page callers | Call primary key, selected call-root IDs only. | One batch, at most selected roots; parity fixture verifies LIVE/ENDED/RECORD_DELETED. |
| note | Benchmark-only owner/read-only probes | One exact channel reference (planner chose scan of the 33-row channel table) and one session-setting expression. | SELECT-only EXPLAIN: 0.051 ms/one shared buffer and 0.009 ms respectively; outside measured operations. Never production request-path queries. |

## Remaining integration work

- Compose the reviewed sequence implementation and replace the one zero seam;
  validate sequence-before-page and change-replay behavior under writes.
- Generate/commit SQLx metadata on the coordinating branch and rerun the full
  Rust validation sequence and final stack checks there.
- Verify the final served GraphQL flow and connected trace in the permitted
  integration environment. Preserve the documented accepted latency and
  large-imported-thread limits in the final report.

This audit changed only two compatibility fixtures, adding `import_order: None`
in `crates/channels/src/domain/message_delivery/test.rs` and
`crates/channels/src/inbound/toolset/types/test.rs`; both are in fixture commit
`6c12707d5a`. The broader fixture changes were made by the implementation owner.
