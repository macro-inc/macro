# Channel GraphQL read handoff

Branch: `synoet/channels-local-sync-gql`  
Head: `fe958645209323b3ec9b8f5951397e9f12c3f570`  
Base: reviewed sequence head `e19d14d79a2b38eed19f38a0716ea616e4c6c6d2`

Implementation and tests were completed at the head above on 2026-11-12.
This historical report and its proof files were preserved on 2026-11-19 for
machine migration. Validation was not rerun during preservation. See
proofs/channels-local-sync-gql/README.md for the archive and known limitations.
The shared `channels` stack was only read; it was never written, restarted,
rebuilt or reseeded. All mutable test/performance fixtures used private PG18.4
on `/tmp` port 35432.

## Delivered

- Four authenticated GraphQL reads, flattened onto GraphqlUser: channelTimeline,
  channelThread, channelMessage and channelChanges. Separate GraphqlChannelMessage
  identity, all contract fields/nullability, lossless timestamps and sort keys.
- Primary-backed ChannelGraphqlContext supplied to HTTP and WebSocket requests
  from the same messages service as REST. Authorization and business policy stay
  in domain services; GraphQL handles validation and projection.
- Bounded thread reads, preserving REST's full-thread endpoint, imported ordering,
  live-reply selection, preview/counts, and around/before/after behavior.
- Index-backed older/newer timeline seeks, also benefiting REST.
- Real channel_seq is awaited before each timeline/thread page. channelChanges
  calls the reviewed domain read and preserves resets, reached sequence, hasMore,
  current roots/replies, activities and removedIds. No zero seam remains.
- Spans, composed-schema equality tests, generated SDL and dependency metadata.
  No web changes, feature flags, new indexes or planner setting changes.

## Validation

Every test used SQLX_OFFLINE unset and the migrated private database. Nix commands
set DATABASE_URL after entering the shell and RUSTC_WRAPPER empty per invocation.

| Crate | Passed | Evidence in /tmp |
| --- | ---: | --- |
| messages, all features | 196 | channels-seq-messages-test-final.log |
| graphql_channel, release | 2 | channels-graphql-channel-seq-final.log |
| complete_graph, release | 119 | channels-complete-graph-seq-final.log |
| channels, all features | 387 | channels-seq-downstream-test.log |
| documents, all features | 541 | channels-seq-downstream-test.log |
| document_storage_service, all features | 98 | channels-seq-downstream-test.log |
| agent_trigger, outbound enabled | 180 | channels-post-seq-fixture-crates-test.log |
| bots | 129 | channels-post-seq-fixture-crates-test.log |
| channel_bots | 45 | channels-post-seq-fixture-crates-test.log |
| scheduled_action | 468 | channels-post-seq-fixture-crates-test.log |
| agent_harness | 559 | channels-post-seq-agent-harness-nextest.log |

Total: 2,724 passing crate tests. Messages has two ignored opt-in benchmarks;
complete_graph has one ignored benchmark, which was separately run three times.
Scheduled action includes six integration tests. Harness passed cargo test
--no-run and nextest with two isolated processes. Binary/doc tests passed.
Two synthetic channel-bot events were updated with seq: None after the rebase.

`just check` passed on the final diff, including formatting, code rules, PII and
SDL compatibility: `/tmp/channels-seq-check-complete.log`. Existing repository-wide
cargo-shear advisory warnings remain. Dependency generation and `cargo x deps
--check` passed; privacy passed. SDL was regenerated and is byte-identical to the
committed file (SHA256 eaa1a9aa36aebbbcd18214b1c57d2a696f7be2b6513b304706d2dc034f0e43d8).
See `/tmp/channels-sdl-seq-final.log` and `/tmp/channels-seq-privacy-final.log`.
Independent source/architecture audit: `/tmp/channels-seq-audit.md`.

### Equality and ordering tests

All through the composed schema against the same domain calls REST uses:

- channel_timeline_matches_rest_every_page_and_around_window
- channel_thread_pages_match_rest_and_sort_keys_follow_import_order
- channel_single_message_matches_rest_and_respects_channel_access
- channel_changes_match_domain_current_states_tombstones_and_removed_ids
- channel_changes_page_200_log_rows_and_hydrate_each_id_once
- channel_changes_reset_for_pruned_future_reset_and_lagged_cursors
- channel_changes_validate_sequences_and_preserve_access_scope
- channel_page_watermarks_are_read_before_page_queries

The rich fixture includes imported replies/ties, roots, tombstones, a deleted
thread, attachments, reactions, mentions, a bot, selected/unselected activity
and all call states. Timeline walks every older page, newer pages from the
oldest, and around root/reply/first/last targets at multiple page sizes. Thread
pages concatenate to the full REST thread. Sort-key order matches server order.
Replay covers 450 log rows as 200/200/50, current-state projection, root inference
from reply-only changes, hard deletions, foreign IDs, reset/floor/future/lag
boundaries, and explicit seq-before-page call ordering.

## SQL plans

Read-only shared PostgreSQL 18.6, 50,000 messages / 40,000 roots, cursor 32,000 roots
back, LIMIT 51, warm buffers. Values are first/repeated execution milliseconds.

| Query | Plan | Before ms | After ms | Shared hit buffers before/after |
| --- | --- | --- | --- | --- |
| older | custom | 10.969 / 10.085 | 0.348 / 0.268 | 2118 / 162 |
| older | generic | 4.906 / 4.789 | 0.244 / 0.220 | 2534 / 165 |
| newer | custom | 0.236 / 0.215 | 0.239 / 0.223 | 160 / 160 |
| newer | generic | 1.818 / 1.465 | 0.260 / 0.218 | 757 / 160 |
| thread older, 250 replies | custom | new | 0.356 / 0.337 | 412–413 |
| thread older, 250 replies | generic | new | 0.367 / 0.353 | 412–413 |
| thread newer, 250 replies | custom | new | 0.350 / 0.335 | 412–413 |
| thread newer, 250 replies | generic | new | 0.348 / 0.322 | 412–413 |

New timeline plans seek idx_comms_messages_parent_timeline. Old generic plans
filtered 32,001/8,000 older/newer rows; new scans visit 51/52 roots. The old custom
older plan hashed 51,751 live messages; the correlated live-reply lookup now
uses the thread index. Reply pages use idx_comms_messages_thread_order and check
channel/thread membership before each branch LIMIT. Twelve SELECT-only old/new
full-record comparisons returned zero differences.

SQL and EXPLAIN(ANALYZE, BUFFERS): `/tmp/channels-query-plans.{sql,txt}`,
`/tmp/channels-final-query-plans.txt`, `/tmp/channels-sql-parity.{sql,txt}`.

### Thread scale, accepted no-new-index decision

Private PG18.4 fixtures with 100k background roots. Milliseconds, first/repeated.

| Replies | Query | Custom ms | Generic ms |
| --- | --- | --- | --- |
| 50 | latest | 0.420 / 0.259 | 0.342 / 0.280 |
| 50 | older | 0.148 / 0.130 | 0.151 / 0.135 |
| 50 | newer | 0.149 / 0.155 | 0.130 / 0.127 |
| 50 | root count/max | 0.058 / 0.026 | 0.038 / 0.021 |
| 50 | root preview | 0.144 / 0.046 | 0.025 / 0.016 |
| 1000 | latest | 0.503 / 0.334 | 0.356 / 0.274 |
| 1000 | older | 0.363 / 0.350 | 0.330 / 0.324 |
| 1000 | newer | 0.273 / 0.250 | 0.285 / 0.261 |
| 1000 | root count/max | 0.254 / 0.152 | 0.280 / 0.219 |
| 1000 | root preview | 0.146 / 0.032 | 0.023 / 0.034 |
| 100250 | latest | 13.891 / 10.643 | 11.327 / 10.837 |
| 100250 | older | 0.313 / 0.271 | 0.327 / 0.264 |
| 100250 | newer | 11.259 / 10.238 | 10.373 / 10.140 |
| 100250 | root count/max | 15.078 / 15.757 | 14.448 / 14.758 |
| 100250 | root preview | 0.157 / 0.043 | 0.027 / 0.035 |

The 100,250 case has 100,200 imported plus 50 ordinary replies. With stale
statistics, the ordinary bucket scans the imported prefix (~3,002 buffers);
count/max walks the thread (~2,593 buffers). This is the accepted slow edge
(parent decision #522); no new write-costing index or planner workaround was added.
SQL/plans: `/tmp/channels-thread-{50,1000,100250}-{plans,preview}.{sql,txt}`;
full notes: `/tmp/channels-domain-query-report.md`.

## Latest-page server timing with real sequence

The immutable shared stack lacks sequence tables. A private copy preserves all
rows byte-for-byte: 50,000 messages, 40,000 threads, 219 attachments, 19,589 reactions,
1,480 mentions, no activity/call rows. CSV hashes match; the private copy has
counter 1 and a reset row representing one historical import. Manifest:
`/tmp/channels-gql-private-fixture/manifest.json`.

Release build, debug assertions disabled, 50-entry page, 20 warmup pairs and 200
alternating pairs per run, same warmed four-connection read-only pool. Includes
GraphQL parse/validate/resolve/full-field JSON and REST domain+DTO JSON. Access
is stubbed equally; HTTP/network and production auth queries are excluded.

| Run | GraphQL median / p95 ms | REST median / p95 ms | Median gap ms |
| --- | --- | --- | --- |
| First, overlapping compile/link work | 3.158 / 10.901 | 2.048 / 6.002 | +1.110 |
| No-build repeat 1 | 2.261 / 2.557 | 1.391 / 1.708 | +0.870 |
| No-build repeat 2 | 2.217 / 2.879 | 1.400 / 1.900 | +0.816 |

Repeat1/2 phase medians (ms): auth .002/.002; seq .054/.053; domain 1.286/1.317;
mapping .045/.043; execution residual .729/.726; JSON .043/.041.
REST domain 1.302/1.319 and JSON .079/.071. Domain time is comparable; GraphQL
execution accounts for most overhead. All three samples are retained.

Exactly 10 GraphQL versus 9 REST SQL statements in every run. The sole extra
query is the counter primary-key lookup, executed first. Shared statements:
channel existence, activity page, root page, thread count/latest, bounded
preview, attachments, reactions, mentions and bots. No per-entry query or await.
Conditional call-state reads are covered by rich parity fixtures.

Full phase values and SQL templates: `/tmp/channels-gql-real-seq-perf-report.md`;
raw `/tmp/channels-perf-real-seq-release.log`,
`/tmp/channels-perf-real-seq-repeat-{1,2}.log`.

## Explicit gaps and decisions

- The strict GraphQL-not-slower target is unmet: warm median overhead is
  0.816–0.870ms. Reported per parent decision #543; no caching workaround added.
- Parent owns `just prepare_db`; the sequence branch's .sqlx cache was preserved
  exactly. No worker cache files were changed. New root/around/thread and rewritten
  older/newer queries need metadata, as do the new test fixture queries.
- `just rust-check` stops at six missing worker query-cache entries and six
  consequent inference errors. `/tmp/channels-seq-rust-check-clean.log` lists
  thread.rs:10,38,170,187 and timeline.rs:175,200. The validation workflow stops
  there; clippy and remaining recipe sequence are deferred until parent prepare.
  Standalone formatting and dependency generation/check already passed.
- Real served HTTP/WebSocket trace inspection in Tempo remains for integration;
  no shared service was rebuilt. In-process phase spans were exercised.
- Sort keys assume post-epoch timestamps and nonnegative import_order, as agreed
  in decision #512; unexpected negatives clamp to 0 rather than panic.

## Local commits above the reviewed sequence base

264801903c feat(messages): add bounded thread reads and seek timeline cursors
ccb716fa8a feat(graphql-channel): add authenticated channel read adapters
dd3c037e64 feat(graphql-channel): compose message reads with REST parity
9bcafa55c3 fix(graphql-channel): declare the service adapter dependency
8c5c7fd10d test(messages): initialize ordering in dependent fixtures
a56a6f4253 fix(messages): preserve ordering after sequence integration
1e82447624 feat(graphql-channel): replay committed channel changes
f854622991 test(graphql-channel): measure sequenced page reads
fe95864520 test(channels): complete sequence integration coverage
