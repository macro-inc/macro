# Channel change query plans

Final synthetic fixture: 1,000,000 channel log rows (100,000 in the selected channel and 900,000 across nine other channels); 1,990,000 messages; 1,000,000 thread states; 100,010 counters; 100,000 bot records; and 1,000,000 rows each in activity, attachments, reactions and mentions. Selected roots have 99 replies. The proof covers 200 changed IDs / roots, 800 reference and bot IDs, and a 10,000-row prune batch. The 1m thread fixture reaches the top of the documented 100k–1m production tier. Other per-message tables are assumed large.

Each version ran 18 exact SQL shapes twice with custom plans and twice with generic plans, against separately created fresh and stale-statistics databases (144 runs per version, 288 total). Stale databases were analyzed with a tiny fixture and then enlarged with autovacuum disabled. Settings: random_page_cost=1.1, work_mem=16MB, jit=off, statement_timeout=60s. Writes and row locks were rolled back after every EXPLAIN. First runs are not a claimed cold cache.

No final plan has a sequential scan. Narrowing predicates are index conditions; root/thread counts are bounded by 200 requested roots and 99 replies per seeded root, previews by three rows per root. The prune uses the created_at index to select 10,000 TIDs and a Tid Scan to delete exactly those rows. The service enforces a 15s timeout for changes hydration/log reads and prune transactions.

Counter/log SQL lives in `crates/channel_change_db_utils`. The counter read, log snapshot and prune SQL remain identical to the measured queries in the main matrix. The scalar and activity appends now include a scoped counter lock timeout; their updated exact-SQL measurements and prior comparison are recorded separately below. Callers retain their transaction boundaries and domain policy.

Call deletion captures `channel_id` from `call_entities` only when its stored discussion is `channel_thread`, before deletion triggers remove the call entity. Archival uses the channel and discussion it already reads. Both paths append the canonical call ID through the same scalar utility as other message changes, as their final statement before commit. It no longer queries message storage to locate the root; logging an absent root is deliberate so the delta read can return its removed ID. The metadata lookup is reproduced separately by `channel_call_metadata_plans.sql`; the scalar append is reproduced by `channel_change_append_plans.sql`.

An earlier calendar-style DELETE USING plan was rejected: PostgreSQL 18 fresh/generic scanned all 1m rows (120.773ms), and stale/custom scanned all 1m rows (198.723ms). The final ctid-array query removes that scan; rejected evidence remains in /tmp/channel_seq_read_plans/rejected_prune_summary.json.

Values below are first / repeated execution time in milliseconds and shared hit+read buffer counts. Full plans, exact SQL and seeds are adjacent to each summary.json.

| PostgreSQL | Stats | Query | Custom ms | Custom buffers H+R | Generic ms | Generic buffers H+R |
| --- | --- | --- | --- | --- | --- | --- |
| 18.4 | fresh | reply_root_lock | 0.107 / 0.025 | 1+9 / 10+0 | 0.078 / 0.028 | 10+0 / 10+0 |
| 18.4 | fresh | counter | 0.040 / 0.007 | 0+4 / 4+0 | 0.033 / 0.018 | 4+0 / 4+0 |
| 18.4 | fresh | log_caught_up | 0.164 / 0.038 | 8+7 / 12+0 | 0.129 / 0.047 | 15+0 / 12+0 |
| 18.4 | fresh | log_delta | 0.464 / 0.238 | 15+8 / 20+0 | 0.375 / 0.230 | 23+0 / 20+0 |
| 18.4 | fresh | log_lagged | 0.143 / 0.034 | 12+0 / 9+0 | 0.148 / 0.030 | 12+0 / 9+0 |
| 18.4 | fresh | log_missing | 0.118 / 0.027 | 10+2 / 9+0 | 0.104 / 0.028 | 12+0 / 9+0 |
| 18.4 | fresh | changed_messages | 2.843 / 1.578 | 560+478 / 1032+0 | 1.975 / 1.223 | 1407+0 / 1401+0 |
| 18.4 | fresh | root_rows | 1.695 / 1.020 | 437+0 / 431+0 | 1.491 / 0.932 | 437+0 / 431+0 |
| 18.4 | fresh | root_states | 2.949 / 2.620 | 1104+105 / 1209+0 | 2.950 / 2.657 | 1209+0 / 1209+0 |
| 18.4 | fresh | root_previews | 3.280 / 2.280 | 629+181 / 810+0 | 2.965 / 2.172 | 810+0 / 810+0 |
| 18.4 | fresh | attachments | 1.505 / 0.682 | 50+288 / 332+0 | 1.109 / 0.608 | 338+0 / 332+0 |
| 18.4 | fresh | reactions | 1.626 / 0.832 | 50+285 / 329+0 | 1.207 / 0.875 | 90+168 / 252+0 |
| 18.4 | fresh | mentions | 1.562 / 0.628 | 351+221 / 569+0 | 1.363 / 0.848 | 572+0 / 569+0 |
| 18.4 | fresh | bots | 0.228 / 0.144 | 0+20 / 20+0 | 0.211 / 0.155 | 20+0 / 20+0 |
| 18.4 | fresh | activities | 0.247 / 0.191 | 3+8 / 8+0 | 0.246 / 0.192 | 11+0 / 8+0 |
| 18.4 | fresh | prune | 6.672 / 5.824 | 20014+132 / 20134+0 | 6.201 / 5.807 | 20146+0 / 20134+0 |
| 18.4 | stale | reply_root_lock | 0.098 / 0.032 | 1+8 / 9+0 | 0.117 / 0.032 | 9+0 / 9+0 |
| 18.4 | stale | counter | 0.048 / 0.007 | 0+4 / 4+0 | 0.047 / 0.010 | 4+0 / 4+0 |
| 18.4 | stale | log_caught_up | 0.212 / 0.044 | 8+6 / 11+0 | 0.133 / 0.034 | 14+0 / 11+0 |
| 18.4 | stale | log_delta | 0.352 / 0.219 | 14+8 / 19+0 | 0.348 / 0.227 | 22+0 / 19+0 |
| 18.4 | stale | log_lagged | 0.109 / 0.031 | 11+0 / 8+0 | 0.106 / 0.026 | 11+0 / 8+0 |
| 18.4 | stale | log_missing | 0.109 / 0.024 | 10+2 / 9+0 | 0.124 / 0.026 | 12+0 / 9+0 |
| 18.4 | stale | changed_messages | 2.209 / 1.323 | 959+278 / 1231+0 | 2.651 / 1.509 | 1037+200 / 1231+0 |
| 18.4 | stale | root_rows | 1.594 / 1.044 | 437+0 / 431+0 | 1.585 / 1.036 | 437+0 / 431+0 |
| 18.4 | stale | root_states | 5.695 / 4.380 | 1673+412 / 2085+0 | 5.201 / 3.966 | 2085+0 / 2085+0 |
| 18.4 | stale | root_previews | 3.135 / 2.110 | 644+166 / 810+0 | 2.599 / 1.977 | 810+0 / 810+0 |
| 18.4 | stale | attachments | 1.444 / 0.612 | 50+288 / 332+0 | 1.807 / 0.542 | 338+0 / 332+0 |
| 18.4 | stale | reactions | 1.604 / 0.728 | 50+285 / 329+0 | 1.262 / 0.684 | 335+0 / 329+0 |
| 18.4 | stale | mentions | 2.037 / 0.740 | 87+377 / 461+0 | 1.261 / 0.716 | 464+0 / 461+0 |
| 18.4 | stale | bots | 0.221 / 0.133 | 0+20 / 20+0 | 0.225 / 0.122 | 20+0 / 20+0 |
| 18.4 | stale | activities | 0.247 / 0.176 | 3+8 / 8+0 | 0.223 / 0.167 | 11+0 / 8+0 |
| 18.4 | stale | prune | 6.750 / 5.994 | 20014+132 / 20134+0 | 6.588 / 5.863 | 20146+0 / 20134+0 |
| 14.23 | fresh | reply_root_lock | 0.112 / 0.023 | 2+8 / 10+0 | 0.079 / 0.023 | 10+0 / 10+0 |
| 14.23 | fresh | counter | 0.053 / 0.007 | 0+4 / 4+0 | 0.046 / 0.008 | 4+0 / 4+0 |
| 14.23 | fresh | log_caught_up | 0.134 / 0.039 | 8+6 / 11+0 | 0.137 / 0.035 | 14+0 / 11+0 |
| 14.23 | fresh | log_delta | 0.347 / 0.225 | 14+8 / 19+0 | 0.370 / 0.224 | 22+0 / 19+0 |
| 14.23 | fresh | log_lagged | 0.120 / 0.030 | 11+0 / 8+0 | 0.135 / 0.032 | 11+0 / 8+0 |
| 14.23 | fresh | log_missing | 0.123 / 0.033 | 10+2 / 9+0 | 0.115 / 0.024 | 12+0 / 9+0 |
| 14.23 | fresh | changed_messages | 3.136 / 1.156 | 932+478 / 1401+0 | 2.311 / 1.238 | 1410+0 / 1401+0 |
| 14.23 | fresh | root_rows | 1.853 / 0.782 | 809+0 / 800+0 | 1.967 / 0.883 | 809+0 / 800+0 |
| 14.23 | fresh | root_states | 3.020 / 2.657 | 1704+105 / 1806+0 | 2.972 / 2.647 | 1809+0 / 1806+0 |
| 14.23 | fresh | root_previews | 3.323 / 2.086 | 629+181 / 810+0 | 3.021 / 2.003 | 810+0 / 810+0 |
| 14.23 | fresh | attachments | 1.950 / 0.874 | 2330+288 / 2609+0 | 1.732 / 0.968 | 2618+0 / 2609+0 |
| 14.23 | fresh | reactions | 2.304 / 1.364 | 2330+285 / 2606+0 | 1.774 / 0.970 | 2242+168 / 2401+0 |
| 14.23 | fresh | mentions | 2.157 / 1.269 | 2194+213 / 2401+0 | 1.662 / 1.274 | 2407+0 / 2401+0 |
| 14.23 | fresh | bots | 0.682 / 0.437 | 2397+20 / 2414+0 | 0.527 / 0.444 | 2417+0 / 2414+0 |
| 14.23 | fresh | activities | 0.353 / 0.310 | 603+8 / 605+0 | 0.323 / 0.290 | 611+0 / 605+0 |
| 14.23 | fresh | prune | 6.678 / 5.865 | 20117+133 / 20134+0 | 6.128 / 5.918 | 20146+0 / 20134+0 |
| 14.23 | stale | reply_root_lock | 0.101 / 0.019 | 2+7 / 9+0 | 0.090 / 0.029 | 9+0 / 9+0 |
| 14.23 | stale | counter | 0.070 / 0.008 | 0+4 / 4+0 | 0.035 / 0.016 | 4+0 / 4+0 |
| 14.23 | stale | log_caught_up | 0.153 / 0.040 | 8+6 / 11+0 | 0.121 / 0.026 | 14+0 / 11+0 |
| 14.23 | stale | log_delta | 0.368 / 0.225 | 14+8 / 19+0 | 0.362 / 0.245 | 22+0 / 19+0 |
| 14.23 | stale | log_lagged | 0.121 / 0.029 | 11+0 / 8+0 | 0.133 / 0.044 | 11+0 / 8+0 |
| 14.23 | stale | log_missing | 0.136 / 0.038 | 10+2 / 9+0 | 0.114 / 0.029 | 12+0 / 9+0 |
| 14.23 | stale | changed_messages | 2.455 / 1.284 | 1331+278 / 1600+0 | 3.087 / 1.631 | 1409+200 / 1600+0 |
| 14.23 | stale | root_rows | 1.521 / 0.798 | 809+0 / 800+0 | 1.627 / 0.953 | 809+0 / 800+0 |
| 14.23 | stale | root_states | 6.053 / 3.887 | 2273+412 / 2682+0 | 5.807 / 4.125 | 2685+0 / 2682+0 |
| 14.23 | stale | root_previews | 3.455 / 2.388 | 644+166 / 810+0 | 3.038 / 1.909 | 810+0 / 810+0 |
| 14.23 | stale | attachments | 2.110 / 0.934 | 2330+288 / 2609+0 | 1.587 / 0.790 | 2618+0 / 2609+0 |
| 14.23 | stale | reactions | 2.547 / 1.251 | 2330+285 / 2606+0 | 1.883 / 1.205 | 2615+0 / 2606+0 |
| 14.23 | stale | mentions | 3.117 / 1.729 | 2238+378 / 2610+0 | 2.299 / 1.476 | 2616+0 / 2610+0 |
| 14.23 | stale | bots | 0.571 / 0.452 | 2417+0 / 2414+0 | 0.530 / 0.459 | 2417+0 / 2414+0 |
| 14.23 | stale | activities | 0.377 / 0.283 | 603+8 / 605+0 | 0.365 / 0.307 | 611+0 / 605+0 |
| 14.23 | stale | prune | 7.073 / 6.142 | 20014+132 / 20134+0 | 6.430 / 6.004 | 20146+0 / 20134+0 |
| 18.4 | fresh | write_hydration | 0.267 / 0.099 | 22+0 / 16+0 | 0.071 / 0.058 | 16+0 / 16+0 |
| 18.4 | fresh | write_hydration_missing | 0.052 / 0.019 | 1+2 / 3+0 | 0.032 / 0.015 | 3+0 / 3+0 |
| 18.4 | stale | write_hydration | 0.262 / 0.064 | 16+6 / 16+0 | 0.046 / 0.042 | 16+0 / 16+0 |
| 18.4 | stale | write_hydration_missing | 0.036 / 0.014 | 1+2 / 3+0 | 0.015 / 0.011 | 3+0 / 3+0 |
| 14.23 | fresh | write_hydration | 0.290 / 0.099 | 38+0 / 16+0 | 0.074 / 0.049 | 16+0 / 16+0 |
| 14.23 | fresh | write_hydration_missing | 0.032 / 0.015 | 1+2 / 3+0 | 0.012 / 0.010 | 3+0 / 3+0 |
| 14.23 | stale | write_hydration | 0.260 / 0.075 | 35+3 / 16+0 | 0.058 / 0.041 | 16+0 / 16+0 |
| 14.23 | stale | write_hydration_missing | 0.035 / 0.016 | 1+2 / 3+0 | 0.014 / 0.012 | 3+0 / 3+0 |

The two channel-write hydration cases were measured in a follow-up on the same fixtures and with the same planner settings. The present-message query seeks one message through `comms_messages_parent_identity`; each attachment, reaction, and mention aggregate is bounded by that message ID. Missing messages return zero rows without executing the aggregates. PostgreSQL 14.23 took 0.010–0.290 ms with at most 38 total shared buffers; PostgreSQL 18.4 took 0.011–0.267 ms with at most 22. Full follow-up plans are in `/tmp/channel-write-hydration-{fresh14,stale14,fresh18,stale18}.log`; normalized results are in `/tmp/channel-write-hydration-plan-summary.json`.

Reproduction: `crates/messages/proofs/channel_change_plans.py` extracts the exact current Rust SQL and creates fresh disposable databases without changing existing ones. Read `crates/messages/proofs/README.md`.

Evidence paths: `/tmp/channel_seq_read_plans/summary.json` (PostgreSQL 18.4) and `/tmp/channel_seq_read_plans_pg14/summary.json` (PostgreSQL 14.23); full plans are `*_*.json.txt` in the same directories.

## Scoped counter timeout append plans

The current **50 ms** scalar and activity statements were extracted byte for
byte from `crates/channel_change_db_utils/src/append.rs` into
`channel_change_append_plans.sql`; `sync_append_plan_sql.py --check` verifies
that match without a database connection. These 32 current runs cover PostgreSQL
18.4 and 14.23, fresh/stale statistics, custom/generic plans, and first/repeated
executions. Each statistics case used a new scratch database with 1,100,000 log
rows across 11 counters. Stale statistics were collected on one row before
seeding the remainder, with autovacuum disabled. Planner settings were
`random_page_cost=1.1`, `work_mem=16MB`, `jit=off`; measured statements ran under
`statement_timeout=15s` and an inherited `lock_timeout=5s`. The append itself
temporarily caps counter row waits at 50 ms and restores that inherited value.
Every measured write and its fixture were rolled back.

No current plan has a sequential scan or a large-table scan. The counter
INSERT uses `channel_change_counters_pkey` for conflict arbitration: one
counter for a scalar append, two for the four-activity batch. Returned log rows
are respectively one and four. No node returns more than four rows per loop.
Remaining scans consume only those bounded CTE/input rows; the restoration
aggregate reads the completed log output. The materialized configuration and
restoration stages remain in all plans. These are uncontended statement-cost
measurements, not a bound on commit time or a substitute for the separate
concurrent-writer and pool-isolation tests.

Current 50 ms values are first / repeated execution milliseconds and shared
hit+read buffers:

| PostgreSQL | Stats | Append | Custom ms | Custom buffers H+R | Generic ms | Generic buffers H+R |
| --- | --- | --- | --- | --- | --- | --- |
| 18.4 | fresh | scalar | 0.206 / 0.100 | 11+2 / 10+0 | 0.078 / 0.086 | 10+0 / 10+0 |
| 18.4 | fresh | four activities | 0.223 / 0.180 | 27+2 / 32+0 | 0.119 / 0.110 | 32+0 / 32+0 |
| 18.4 | stale | scalar | 0.199 / 0.067 | 7+3 / 10+0 | 0.099 / 0.069 | 10+0 / 10+0 |
| 18.4 | stale | four activities | 0.157 / 0.118 | 28+1 / 32+0 | 0.113 / 0.099 | 32+0 / 32+0 |
| 14.23 | fresh | scalar | 0.174 / 0.073 | 9+4 / 10+0 | 0.055 / 0.034 | 10+0 / 10+0 |
| 14.23 | fresh | four activities | 0.149 / 0.109 | 27+2 / 32+0 | 0.094 / 0.076 | 32+0 / 32+0 |
| 14.23 | stale | scalar | 0.149 / 0.074 | 7+3 / 10+0 | 0.048 / 0.059 | 10+0 / 10+0 |
| 14.23 | stale | four activities | 0.155 / 0.147 | 28+1 / 32+0 | 0.129 / 0.095 | 32+0 / 32+0 |

The earlier runs below are preserved as historical measurements, with phases
`unbounded`, `bounded5ms`, and `bounded50ms` in the CSV. The 5 ms measurements
were taken before the cap was increased; they do not describe current SQL.
The three phases ran at different times and are not a paired latency experiment.

| PostgreSQL | Append | Unbounded min–max ms | Historical 5 ms min–max ms | Current 50 ms min–max ms |
| --- | --- | --- | --- | --- |
| 18.4 | scalar | 0.021–0.256 | 0.035–0.193 | 0.067–0.206 |
| 18.4 | four activities | 0.070–0.153 | 0.089–0.187 | 0.099–0.223 |
| 14.23 | scalar | 0.020–0.152 | 0.044–0.195 | 0.034–0.174 |
| 14.23 | four activities | 0.064–0.133 | 0.086–0.172 | 0.076–0.155 |

[All 96 run summaries](channel_change_append_plan_runs.csv) retain the
measurements and row/index checks. Current 50 ms full plans are in
`/tmp/channel-seq-timeout50-append-{18,14}-{fresh,stale}-20261112_064802.log`;
the normalized artifact is `/tmp/channel-seq-timeout50-append-summary.json`.
Historical 5 ms plans are
`/tmp/channel-seq-timeout-append-{18,14}-{fresh,stale}-20261112_064000_711895.log`
and `/tmp/channel-seq-timeout-append-summary.json`. Unbounded full plans are
`/tmp/channel-append-plans{,14}-{fresh,stale}.log`.
Reproduce the current phase with `sync_append_plan_sql.py --check`, then run
`channel_change_append_plans.sql` as described in [README.md](README.md).

The call-owned metadata lookup was measured separately on 1,100,000 `call_entities` rows: 100,000 in the selected channel and ten times that across other channels. Its 48 runs cover PostgreSQL 14.23 and 18.4, fresh/stale statistics, custom/generic plans, and first/repeated executions for channel-thread, legacy-chat, and missing identities. Every run used `call_entities_pkey` to inspect at most one call; discussion and channel predicates filter that single row. Across the matrix the lookup took 0.002–0.034 ms and at most four shared buffers. The measured statement timeout was 15 seconds; the seed and all mutations rolled back.

| PostgreSQL | Stats | Call identity | Custom ms | Custom buffers H+R | Generic ms | Generic buffers H+R |
| --- | --- | --- | --- | --- | --- | --- |
| 18.4 | fresh | channel thread | 0.034 / 0.008 | 1+3 / 4+0 | 0.009 / 0.006 | 4+0 / 4+0 |
| 18.4 | fresh | legacy call chat | 0.004 / 0.004 | 4+0 / 4+0 | 0.004 / 0.003 | 4+0 / 4+0 |
| 18.4 | fresh | missing call | 0.007 / 0.003 | 3+0 / 3+0 | 0.003 / 0.003 | 3+0 / 3+0 |
| 18.4 | stale | channel thread | 0.029 / 0.006 | 1+3 / 4+0 | 0.006 / 0.003 | 4+0 / 4+0 |
| 18.4 | stale | legacy call chat | 0.002 / 0.002 | 4+0 / 4+0 | 0.002 / 0.002 | 4+0 / 4+0 |
| 18.4 | stale | missing call | 0.005 / 0.002 | 3+0 / 3+0 | 0.002 / 0.002 | 3+0 / 3+0 |
| 14.23 | fresh | channel thread | 0.028 / 0.005 | 1+3 / 4+0 | 0.005 / 0.003 | 4+0 / 4+0 |
| 14.23 | fresh | legacy call chat | 0.002 / 0.002 | 4+0 / 4+0 | 0.002 / 0.002 | 4+0 / 4+0 |
| 14.23 | fresh | missing call | 0.005 / 0.002 | 3+0 / 3+0 | 0.002 / 0.002 | 3+0 / 3+0 |
| 14.23 | stale | channel thread | 0.019 / 0.005 | 1+3 / 4+0 | 0.006 / 0.003 | 4+0 / 4+0 |
| 14.23 | stale | legacy call chat | 0.003 / 0.002 | 4+0 / 4+0 | 0.002 / 0.003 | 4+0 / 4+0 |
| 14.23 | stale | missing call | 0.007 / 0.002 | 3+0 / 3+0 | 0.002 / 0.002 | 3+0 / 3+0 |

Call metadata reproduction: `crates/messages/proofs/channel_call_metadata_plans.sql`. Full recorded plans are `/tmp/channel-call-metadata-{14,18}-{fresh,stale}.log`; normalized timing, buffer counts, and plan nodes are `/tmp/channel-call-metadata-summary.json`. Deletion uses the already-measured scalar append in `channel_change_append_plans.sql` after this lookup and the call mutation; archival uses that append with its already-read facts. No message-row lookup remains.

## Supplemental unchanged historical body guard

The historical body UPDATE, including `content <> $5`, is unchanged from baseline `354da677b5`. These 32 supplemental plans check its matching-update and idempotent no-op behavior on the existing 1.99m-message / 1m-thread fixtures; they are separate from the 288-query main matrix and do not represent a newly changed query. The planner settings and 15-second statement timeout match the other supplemental measurements. Import metadata is set inside an outer transaction, each sample rolls back to a savepoint, and the outer transaction rolls back at the end.

Every plan seeks at most one message through `comms_messages_parent_identity` or `idx_comms_messages_active`, with `id` in the index condition. The matching case checks one thread through `comms_message_threads_pkey`; the no-op case rejects the one message and skips that thread lookup. No plan has a sequential scan; total shared buffers never exceed 12.

| PostgreSQL | Stats | Case | Custom ms | Custom buffers H+R | Generic ms | Generic buffers H+R |
| --- | --- | --- | --- | --- | --- | --- |
| 18.4 | fresh | matching update | 0.663 / 0.136 | 8+4 / 12+0 | 0.109 / 0.068 | 12+0 / 12+0 |
| 18.4 | fresh | idempotent no-op | 0.014 / 0.010 | 5+0 / 5+0 | 0.008 / 0.006 | 5+0 / 5+0 |
| 18.4 | stale | matching update | 0.627 / 0.117 | 8+4 / 12+0 | 0.101 / 0.067 | 12+0 / 12+0 |
| 18.4 | stale | idempotent no-op | 0.015 / 0.016 | 5+0 / 5+0 | 0.009 / 0.006 | 5+0 / 5+0 |
| 14.23 | fresh | matching update | 0.634 / 0.112 | 8+4 / 12+0 | 0.083 / 0.055 | 12+0 / 12+0 |
| 14.23 | fresh | idempotent no-op | 0.017 / 0.015 | 5+0 / 5+0 | 0.014 / 0.011 | 5+0 / 5+0 |
| 14.23 | stale | matching update | 0.650 / 0.139 | 8+4 / 12+0 | 0.129 / 0.083 | 12+0 / 12+0 |
| 14.23 | stale | idempotent no-op | 0.019 / 0.014 | 5+0 / 5+0 | 0.012 / 0.010 | 5+0 / 5+0 |

Reproduction: `crates/messages/proofs/channel_historical_body_plans.sql` runs only against an existing disposable main-harness fixture. Full logs: `/tmp/channel-historical-{14,18}-{fresh,stale}.log`; normalized results: `/tmp/channel-historical-summary.json`.
