# Final messages read report

Implemented in `crates/messages`:
- `MessageReader::thread_page(access, root_id, MessageThreadQuery)` returns `MessageThreadPage`: root `MessageListItem`, live replies oldest-first, older `next_cursor`, newer `previous_cursor`, and optional call status. Default starts at the oldest replies; before/after/around use `(import_order NULLS LAST, created_at, id)`. A one-row opposite-side probe keeps cursors correct after a reply disappears.
- `MessageReader::get_root` returns a contextual message/call timeline entry under the same parent and live-thread policy as REST. `MessageRepository::root` hydrates roots including tombstones for synchronization callers.
- `Message.import_order` is hydrated internally and excluded from serde, OpenAPI and JSON Schema, preserving REST wire shapes.
- Timeline older/newer cursor comparisons use COALESCE boundaries for generic-plan index seeks. `OFFSET 0` keeps live-reply existence checks correlated instead of scanning all live messages into a hash.
- Thread SQL separates ordering-key selection from full-message hydration, preserves parent/live checks before branch LIMIT, and uses a 15s transaction-local statement timeout. No migration or planner setting ships. Experimental indexes were removed from both disposable databases.
- Hexagonal boundary checked: receipts, parent lifecycle, thread lifecycle, and call-status policy remain in MessageService; SQL and hydration remain in PgMessageRepository. New reads have operation spans. Only test fakes changed outside messages (`channels` and `documents`). The messages agent guide now names the bounded API and reply-order query.

## Validation

`nix develop --command bash -c 'unset SQLX_OFFLINE; export DATABASE_URL="postgresql://user@localhost/macrodb?host=/tmp&port=35432"; cargo test -p messages --all-features'`

Final run: **176 passed, 0 failed**, doc tests0. Log `/tmp/channels-messages-final-test.log`.

New regressions:
- `outbound::pg_message_repo::test::timeline::timeline_keyset_rewrite_matches_previous_sql_selection`: preserves old OR-cursor/EXISTS SQL in test-only SQL files; compares old against new IDs, order and has-more for every cursor, both directions, tied timestamps, channel/document parents, tombstones, deleted threads and limits1/3/100.
- `outbound::pg_message_repo::test::threads::thread_pages_preserve_import_order_ties_tombstones_and_bounds`: forward/backward concatenation equals complete replies, imported order/ties, first/middle/last around windows, stale cursors, root preview/counts, live-only replies and parent isolation.
- `domain::service::test::thread_reads::paged_thread_and_root_reads_share_rest_parent_and_thread_policy`: same parent/live-thread gate as REST and invalid mixed selection rejection.

Root owns `just prepare_db`, final workspace checks, audit and commits; no child commit or push was made.

## Timeline plans

Authorized SELECT-only seeded channels stack: PostgreSQL18.6. Large channel has50,000messages (40,000roots +10,000replies); whole message table52,127rows. Cursor32,000roots behind newest, LIMIT51. Settings random_page_cost1.1, work_mem16MB, jit off. First/repeat runs are not controlled cold-cache claims.

| Query | Plan | Before first/repeat ms | After first/repeat ms | Before/after shared hits |
| --- | --- | --- | --- | --- |
| older | custom | 10.969 / 10.085 | 0.348 / 0.268 | 2118 / 162 |
| older | generic | 4.906 / 4.789 | 0.244 / 0.220 | 2534 / 165 |
| newer | custom | 0.236 / 0.215 | 0.239 / 0.223 | 160 / 160 |
| newer | generic | 1.818 / 1.465 | 0.260 / 0.218 | 757 / 160 |

Old generic plans remove32,001older /8,000newer rows by Filter. New cursor is in `idx_comms_messages_parent_timeline` Index Cond and reads51/52roots, filtering at most one tombstone. Old custom older hashes51,751live messages after encountering a tombstone; new existence lookup uses the thread-active index once.

Raw initial comparison: `/tmp/channels-query-plans.txt`; final exact SQL `/tmp/channels-query-plans.sql`, final remeasurement `/tmp/channels-final-query-plans.txt`.

SELECT-only old/new full-record comparisons on the50,000-message seed, both directions/latest/depth32000/LIMIT1,50,100 found zero differing rows in all12cases: `/tmp/channels-sql-parity.sql`, `/tmp/channels-sql-parity.txt`.

Final thread query on the existing250-reply seeded thread: older custom0.356/0.337ms, generic0.367/0.353ms; newer custom0.350/0.335ms, generic0.348/0.322ms;412–413buffer hits. Same final raw plan file above.

## Final thread scale plans and accepted limit

**The coordinating owner explicitly accepted the100k-imported slow edge (#522): no new index and no planner-setting workaround.** With stale statistics the ordinary/null bucket may scan and filter the imported portion of one thread. Root reply-count metadata independently scans that thread's live replies. No claim of depth-independent thread work is made for this edge.

Disposable PostgreSQL18.4 with100,000background roots and100,000background thread states. Fresh cases:50replies (40imported/10ordinary),1000replies (800imported/200ordinary). Stale case:100,250replies (100,200imported/50ordinary), expanded without ANALYZE with autovacuum disabled. Query limit51. Imported cursor leaves25imported replies before the ordinary bucket in the1000/100250cases. All tables/indexes are isolated from the channels stack.

| Replies | Operation | Custom first/repeat ms | Generic first/repeat ms |
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

At100250replies the ordinary-bucket scan filters100,200imported rows; latest/newer use~3002–3004buffer hits. Older remains415hits. Count/max uses~2593–2597hits and counts100250live replies; max reads one indexed row. Preview stops after3through `idx_comms_messages_thread_order` (3–4hits on repeat). At50/1000replies the page uses197–422hits; count/max13/46hits; preview3hits on repeat. Preview first calls also initialize JSON/system catalog metadata.

Raw final requested cases:
- `/tmp/channels-thread-50-plans.sql`, `/tmp/channels-thread-50-plans.txt`, `/tmp/channels-thread-50-preview.sql`, `/tmp/channels-thread-50-preview.txt`
- `/tmp/channels-thread-1000-plans.sql`, `/tmp/channels-thread-1000-plans.txt`, `/tmp/channels-thread-1000-preview.sql`, `/tmp/channels-thread-1000-preview.txt`
- `/tmp/channels-thread-100250-plans.sql`, `/tmp/channels-thread-100250-plans.txt`, `/tmp/channels-thread-100250-preview.sql`, `/tmp/channels-thread-100250-preview.txt`
-250reply count/max and preview: `/tmp/channels-imported-plans.txt` (custom count/max0.081/0.039ms, generic0.046/0.034ms; preview custom0.039/0.020ms, generic0.026/0.016ms). Count250through the active-thread index, max1row, preview3rows.

Scratch cluster: `/tmp/channels-gql-pgdata`, socket `/tmp`, port35432. Test database `macrodb`; final plan fixtures `channels_query_imports` and `channels_query_imports_stale`. Root may stop/clean this private cluster after all tests; the channels stack was never started/stopped/reseeded or mutated.
