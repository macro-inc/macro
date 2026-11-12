# Admission discovery query plans

All 160 plans run on dedicated local PostgreSQL 14.23/18.4 scratch databases.
The reference fixture has 1,000,000 reference rows and 100,000 jobs and
conversations. It includes a prefix of ten ineligible jobs with 100 pending
references, a later eligible job with ten pending references, and otherwise
completed history. The call fixture has 1,100,000 call entities.

Each query/case runs twice with custom and generic plans, once with refreshed
statistics and once with one-row stale statistics. Synthetic seeds use a
300-second statement timeout; measurements use 15 seconds, random_page_cost=1.1,
work_mem=16MB and JIT off. Every seed and mutation rolls back.

The exact reference SQL is copied from `references.rs`: keyset discovery,
fixed-job eligibility/fence, and the unchanged per-job work lookup. Discovery
seeks the existing partial `slack_import_message_reference_pending` index and
returns at most one row regardless of the ineligible prefix. Eligibility looks
up one job through `slack_import_job_pkey`, one fixture conversation through its
composite primary key, and at most one pending reference. Work lookup uses the
pending-reference index. Every plan has at most one actual row per node and no
sequential scan. The worker cursor persists across capped passes; these plans
measure each bounded lookup, while tests cover progress across skipped jobs.

Calls reuse their existing exact metadata SQL before opening the write
transaction and again during its consistency check. All 48 call plans use
`call_entities_pkey`, inspecting at most one row. The extra discovery query
therefore has the same bounded plan as the existing in-transaction lookup.

| PostgreSQL | Query case | Min–max ms | Max execution buffers H+R |
| --- | --- | --- | --- |
| 18.4 | reference peek_begin | 0.004–0.012 | 2 |
| 18.4 | reference peek_after | 0.002–0.003 | 2 |
| 18.4 | reference peek_end | 0.002–0.003 | 1 |
| 18.4 | reference job_ready | 0.010–0.060 | 11 |
| 18.4 | reference job_blocked | 0.007–0.017 | 10 |
| 18.4 | reference job_missing | 0.005–0.026 | 3 |
| 18.4 | reference work_ready | 0.002–0.007 | 2 |
| 18.4 | call thread | 0.003–0.037 | 4 |
| 18.4 | call legacy | 0.002–0.004 | 4 |
| 18.4 | call missing | 0.002–0.015 | 3 |
| 14.23 | reference peek_begin | 0.003–0.011 | 2 |
| 14.23 | reference peek_after | 0.002–0.004 | 2 |
| 14.23 | reference peek_end | 0.002–0.004 | 1 |
| 14.23 | reference job_ready | 0.010–0.036 | 11 |
| 14.23 | reference job_blocked | 0.007–0.016 | 10 |
| 14.23 | reference job_missing | 0.005–0.008 | 3 |
| 14.23 | reference work_ready | 0.002–0.005 | 2 |
| 14.23 | call thread | 0.003–0.032 | 4 |
| 14.23 | call legacy | 0.002–0.005 | 4 |
| 14.23 | call missing | 0.002–0.012 | 3 |

[All 160 measurements](channel_admission_discovery_plan_runs.csv) retain timings,
row counts, indexes and execution buffer counts. Full plans are in
`/tmp/channel-seq-admission-{reference,call}-{18,14}-{fresh,stale}.log`;
normalized results are `/tmp/channel-seq-admission-discovery-summary.json`.
Reproduce with `channel_reference_admission_plans.sql` and
`channel_call_metadata_plans.sql` as described in [README.md](README.md).

## Agent reply admission lookup

External reply reconciliation now repeats its existing `PgExternalReplyStore::get`
lookup before admission to discover the parent, releases that connection, and
retains the existing lookup after claiming the reply lease to recheck it. The
query text is unchanged and is copied exactly into
`channel_agent_admission_plans.sql`.

The supplemental fixture contains 1,100,000 `agent_external_replies` rows:
100,000 actions for the selected session and 1,000,000 actions for other
sessions. This table is not in the documented production size tiers; the seed
assumes it is large because it grows per reply. All 48 fresh/stale,
custom/generic, first/repeated plans use `agent_external_replies_pkey`, with both
`session_id` and `action_id` in `Index Cond`. Each reads zero or one row, with no
sequential scan or rows removed by a filter. The present case exercises
`to_jsonb(reply)` with a synthetic 256-character payload. These measurements use
the same planner settings and rollback-only seed policy as the matrix above.

| PostgreSQL | Query case | Min–max ms | Max execution buffers H+R |
| --- | --- | --- | --- |
| 18.4 | present | 0.004–0.062 | 4 |
| 18.4 | missing action | 0.002–0.003 | 3 |
| 18.4 | missing session | 0.002–0.008 | 3 |
| 14.23 | present | 0.004–0.049 | 4 |
| 14.23 | missing action | 0.002–0.003 | 3 |
| 14.23 | missing session | 0.002–0.007 | 3 |

[All 48 supplemental measurements](channel_agent_admission_plan_runs.csv) retain
the individual results. Raw plans are in
`/tmp/channel-seq-admission-agent-{18,14}-{fresh,stale}.log` and the normalized
summary is `/tmp/channel-seq-admission-agent-summary.json`. No statement timeout
is required in production for this primary-key lookup; the proof sets 15 seconds
for its measured statements.
