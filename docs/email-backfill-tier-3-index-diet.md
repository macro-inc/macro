# Email backfill Tier 3 index-diet evidence

## Decision status

**No index drop is approved by this document.** Production access was not available in the
T16 builder environment (`doppler me` reported that a token is required), so production
statistics and plans could not be collected without inventing evidence. In particular:

- the statistics-reset or failover timestamp is unknown;
- coverage of inbox sync, search, calendar, deletion, and backfill traffic is unconfirmed;
- production `pg_stat_user_indexes` rows and `EXPLAIN (ANALYZE, BUFFERS)` plans are not saved;
- production sizes of the partial and wider indexes are unknown.

The candidate map and collection procedure below are complete as of 2026-08-06. An operator
with production read access must fill in the evidence record and attach the saved plans before
changing any decision from **retain**. Zero scans alone are not approval: the observation
window and query coverage must also pass.

## Production evidence record

Run this on the current production writer, save the unedited output, and identify the cluster
and database in the review ticket. Counters are cumulative rather than rates.

```sql
SELECT
    current_database() AS database_name,
    current_setting('server_version') AS server_version,
    pg_postmaster_start_time() AS postmaster_started_at,
    pg_is_in_recovery() AS is_replica,
    stats_reset
FROM pg_stat_database
WHERE datname = current_database();

SELECT
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_relation_size(indexrelid) AS index_bytes,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND relname IN ('email_messages', 'email_threads')
ORDER BY relname, indexrelname;
```

`stats_reset` and `pg_postmaster_start_time()` bound the usable counter window but do not prove
the exact managed-database failover time. Confirm the provider event log has no later failover,
writer replacement, or statistics reset and record the later timestamp below.

| Field | Production value |
|---|---|
| Cluster / database | Not collected |
| Snapshot timestamp (UTC) | Not collected |
| `stats_reset` | Not collected |
| `pg_postmaster_start_time()` | Not collected |
| Last provider failover / writer replacement | Not collected |
| Effective observation-window start | Unknown |
| Observation-window duration | Unknown |
| Raw `pg_stat_user_indexes` output | Not attached |

Confirm traffic with production metrics or logs over that same window, not by inference from
index scans. Record volumes and links to the source dashboards.

| Required traffic | Evidence | Covered? |
|---|---|---|
| Representative inbox sync, including message and label updates | Not collected | No |
| Email search and normal thread/message reads | Not collected | No |
| Calendar-only view reads | Not collected | No |
| User/link deletion and cascade cleanup | Not collected | No |
| At least one representative email backfill | Not collected | No |

Until all five rows are **Yes**, every candidate remains retained regardless of `idx_scan`.

## Candidate inventory and query ownership

Migration paths are the defining migration for the live index. The initial schema dump is a
migration in this repository and is cited where it created the index. “Owner” means a current
query shape or database operation that must be represented in production plans; it does not
assert that PostgreSQL currently chooses that index.

| Candidate or comparison index | Definition | Current query owners / purpose | Decision |
|---|---|---|---|
| `idx_email_messages_link_id` | `crates/macro_db_client/migrations/20251212204146_email_delete_indices.sql` | Link deletion and FK/cascade support; link-scoped reads include `crates/email_db_client/src/messages/get_simple_messages.rs` and attachment processing in `crates/email_db_client/src/attachments/provider/upload.rs` | Retain; deletion coverage and scans unknown |
| `idx_email_messages_thread_id_internal_date_asc` | `crates/macro_db_client/migrations/20260106165331_email_subject_search_indices.sql` | First-message metadata, `ORDER BY internal_date_ts ASC NULLS LAST`, in `crates/properties/src/outbound/metadata_queries.rs` | Retain; exact ASC/NULLS owner exists |
| `idx_email_messages_thread_id_internal_date_ts` | `crates/macro_db_client/migrations/20251030154634_email_db_schema.sql` | DESC thread-message reads in `crates/email_db_client/src/messages/get.rs`, `get_parsed.rs`, `get_parsed_search.rs`, and `get_simple_messages.rs`; also `crates/email/src/outbound/email_pg_repo/thread.rs` and `label.rs` | Retain pending paired plans |
| `idx_email_messages_link_id_thread_id_date_asc` | `crates/macro_db_client/migrations/20260106165331_email_subject_search_indices.sql` | Link-scoped subject-search/non-ID query path per migration; current link/thread ordered reads include `crates/email_db_client/src/messages/get.rs` and `get_simple_messages.rs` | Retain; production query coverage unknown |
| `idx_email_messages_link_thread_date` | `crates/macro_db_client/migrations/20251030154634_email_db_schema.sql` | Link/thread DESC message reads in the same DB-client owners above | Retain pending paired plans |
| `idx_email_messages_thread_date_not_draft` | `crates/macro_db_client/migrations/20260107190319_email_preview_indices.sql` | Non-draft latest-message lateral probes in `crates/email/src/outbound/email_pg_repo/preview_views/{all_mail,new_inbox,other_inbox,starred,user_label}.rs` | Retain; partial size and plans not collected |
| `idx_email_messages_latest_content` | `crates/macro_db_client/migrations/20260710150000_email_latest_content_message_index.sql` | Exact latest-content probe using `COALESCE(internal_date_ts, sent_at, created_at) DESC, id DESC` in `crates/email/src/outbound/email_pg_repo/thread.rs` | Retain; expression is not equivalent to the next index |
| `idx_email_messages_thread_id_effective_date_desc` | `crates/macro_db_client/migrations/20260712191131_email_messages_effective_date_index.sql` | Dynamic preview latest-message lateral using `COALESCE(internal_date_ts, created_at) DESC` in `crates/email/src/outbound/email_pg_repo/dynamic/query.rs` | Retain; expression/predicate differ from `latest_content` |
| `idx_email_messages_replying_to_id` | `crates/macro_db_client/migrations/20251212204146_email_delete_indices.sql` | FK/deletion support for the self-reference on `replying_to_id`; no current Rust SELECT owner found | Retain; deletion/FK behavior is not established by scan count alone |
| `idx_email_messages_link_id_replying_to_id` | `crates/macro_db_client/migrations/20251030154634_email_db_schema.sql` | Link-scoped reply updates/resolution in `crates/email_db_client/src/messages/replying_to_id.rs`; overlapping FK/delete coverage | Retain pending deletion and update plans |
| `idx_email_threads_link_id` | `crates/macro_db_client/migrations/20251212204146_email_delete_indices.sql` | Link deletion and link-scoped thread reads in `crates/email_db_client/src/threads/get.rs` | Retain; deletion coverage and scans unknown |

### Already-landed Tier 2 additions

These indexes contribute to write cost and must appear in the same production snapshot. They
are not drop candidates in this pass because they have distinct owners.

| Index | Definition | Current owner |
|---|---|---|
| `idx_email_messages_link_id_sent_covering` | `crates/macro_db_client/migrations/20260805175719_make_sent_messages_index_covering.sql` | Sent-message probes by link; covers `id` and supersedes the older non-covering `idx_email_messages_link_id_sent` only after production verification |
| `idx_email_messages_thread_root_global` | `crates/macro_db_client/migrations/20260714201659_email_messages_thread_root_global_index.sql` | Team-scoped dedupe root selection in `crates/email/src/outbound/email_pg_repo/dynamic/query.rs`; exact `ASC NULLS LAST, id ASC` partial shape |
| `idx_email_messages_link_id_thread_id_has_atts` | `crates/macro_db_client/migrations/20260805185740_index_attachment_bearing_email_threads.sql` | Attachment-bearing thread discovery in `crates/email_db_client/src/attachments/provider/upload.rs` |
| `idx_email_threads_calendar_view_link_ts_id` | `crates/macro_db_client/migrations/20260806163243_replace_email_threads_calendar_view_index.sql` | Calendar-only dynamic view in `crates/email/src/outbound/email_pg_repo/dynamic/query.rs`; exact `DESC NULLS LAST, id DESC` ordering |

The older `idx_email_messages_link_id_sent` is defined by
`20260209101421_email_sent_at_index.sql`. Compare it directly with the covering replacement in
the production snapshot; do not silently omit it from total write-cost accounting.

## Plan and NULL-order evidence

Use representative, non-outlier production IDs from query telemetry. Run each statement twice
with a warm cache, save both outputs, and review the second run. Do not disable sequential
scans or other planner methods: the purpose is to capture the plan PostgreSQL actually chooses.
Use sanitized filenames such as
`email-index-diet/<snapshot-utc>/<candidate>/<owner>-<order>-nulls-<placement>.txt`.

For a nullable btree key, PostgreSQL defaults are `ASC NULLS LAST` and `DESC NULLS FIRST`.
A backward scan reverses both direction and NULL placement. Consequently, a default ASC index
can provide `DESC NULLS FIRST` backward, **not** `DESC NULLS LAST`; direction alone does not
prove equivalence. Record `Index Scan` versus `Index Scan Backward`, the index name, any Sort or
Incremental Sort, rows removed, execution time, and shared/temp buffer counts.

### Thread/date ASC and DESC pair

Run all four variants for a representative large thread. Repeat with `AND link_id = :link_id`
to test the link/thread pair.

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, internal_date_ts FROM email_messages
WHERE thread_id = :thread_id
ORDER BY internal_date_ts ASC NULLS LAST;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, internal_date_ts FROM email_messages
WHERE thread_id = :thread_id
ORDER BY internal_date_ts ASC NULLS FIRST;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, internal_date_ts FROM email_messages
WHERE thread_id = :thread_id
ORDER BY internal_date_ts DESC NULLS LAST;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, internal_date_ts FROM email_messages
WHERE thread_id = :thread_id
ORDER BY internal_date_ts DESC NULLS FIRST;
```

| Pair | ASC FIRST | ASC LAST | DESC FIRST | DESC LAST | Conclusion |
|---|---|---|---|---|---|
| `(thread_id, internal_date_ts)` | Not collected | Not collected | Not collected | Not collected | No drop approved |
| `(link_id, thread_id, internal_date_ts)` | Not collected | Not collected | Not collected | Not collected | No drop approved |

Also save plans for the exact owners, including their `LIMIT`, selected columns, predicates,
and joins. Synthetic projections above verify ordering mechanics but cannot establish query
coverage.

### `thread_date_not_draft` partial comparison

Record raw bytes and the ratio before classifying the partial as redundant:

```sql
SELECT
    pg_relation_size('idx_email_messages_thread_date_not_draft') AS partial_bytes,
    pg_relation_size('idx_email_messages_thread_id_internal_date_ts') AS wider_bytes,
    round(
        pg_relation_size('idx_email_messages_thread_date_not_draft')::numeric /
        NULLIF(pg_relation_size('idx_email_messages_thread_id_internal_date_ts'), 0),
        4
    ) AS partial_to_wider_ratio;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, internal_date_ts
FROM email_messages
WHERE thread_id = :thread_id AND is_draft = FALSE
ORDER BY internal_date_ts DESC NULLS LAST
LIMIT 1;
```

| Evidence | Production value |
|---|---|
| Partial bytes | Not collected |
| Wider bytes | Not collected |
| Partial/wider ratio | Unknown |
| Exact preview-owner plans | Not collected |
| Wider-index alternative shown acceptable | No |

The partial can be substantially smaller and hotter than its wider counterpart. The landed
`idx_email_messages_thread_root_global` does not replace it: that index also requires
`global_id IS NOT NULL` and has an `id` tiebreak for the root-selection owner.

### Effective-date pair

Run the exact owner queries, not a substituted expression. At minimum compare these probes for
the same large thread and include rows where each timestamp is NULL:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id FROM email_messages
WHERE thread_id = :thread_id AND is_draft = FALSE
ORDER BY COALESCE(internal_date_ts, sent_at, created_at) DESC, id DESC
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id FROM email_messages
WHERE thread_id = :thread_id
ORDER BY COALESCE(internal_date_ts, created_at) DESC
LIMIT 1;
```

These expressions and predicates are semantically different, so similar scan counts or names
are insufficient evidence of redundancy.

### Reply and prefix candidates

Save exact production plans for link deletion, message deletion with reply children,
link-scoped message/thread reads, and reply-chain updates. FK enforcement and cascade work may
use an index without appearing as an application query owner. Review lock duration and buffers
for representative large links; do not approve a prefix-index drop from standalone SELECT
plans alone.

## Approval gate

An index may be proposed for a later concurrent-drop batch only when all boxes are checked:

- [ ] Raw production statistics and index sizes are attached.
- [ ] Reset/failover timestamps establish a sufficiently long observation window.
- [ ] The window demonstrably includes all five required traffic classes.
- [ ] Every current owner has a saved exact-query `EXPLAIN (ANALYZE, BUFFERS)` plan.
- [ ] ASC/DESC plans cover both directions and explicitly record both NULL placements.
- [ ] Partial-index size and plan comparisons are acceptable.
- [ ] Tier 2 additions and replaced indexes are included in net write-cost accounting.
- [ ] PI/query telemetry shows no unowned query shape that depends on the candidate.
- [ ] Recreation DDL and post-drop monitoring/rollback thresholds are prepared.

Current result: **gate failed; retain every candidate and create no drop migration.**
