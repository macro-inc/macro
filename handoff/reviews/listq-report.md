# Routine list query plans

**The large-viewer custom grant lookup is unbounded in the size of `scheduled_action`.** It walked the full primary-key index for 1,000,000 routines with fresh statistics and 1,100,000 after growth. The same lookup returned 5,000 IDs in both phases. Execution took 166.665–186.858 ms fresh and 226.282–227.767 ms after growth. The generic plan checked 11,000 matching grants by routine primary key in 53.690–72.976 ms across the two phases.

## Verdicts

- **Children of one parent.** Both modes used `scheduled_action_active_children_idx` for the active arm and `scheduled_action_parent_run_idx` backward for the finished arm. For each populated 100,000-child case, the backward scan considered 226 candidates, filtered out 26 active rows and stopped at 200 finished rows. The 1,000-child cases considered 213 candidates and filtered out 13 active rows. Empty parents read zero child rows. No measured plan read a whole nonempty family or more than 200 finished rows. The largest populated case took 0.089–0.179 ms, including the new parent with stale statistics.
- **Latest runs.** `action_execution_record_action_id_idx` supplied one ordered probe per routine under `LIMIT 1` in every measured mode, including the 100,000-run child in the large per-parent and all-active arrays. The large per-parent case ran 250 probes in 0.352–2.335 ms. The large top-level case ran 5,000 in 11.249–28.179 ms. The large all-active case ran 5,130 before growth and 5,180 after growth in 11.283–13.938 ms. Each probe is bounded by the first visible matching record. Total work scales with the list size.
- **Viewer source IDs.** The active-channel and team membership indexes resolved 5,002 or 52 sources in both modes. The large viewer took 0.821–1.047 ms. Work scales with the viewer's active channel memberships and team membership. This is the cache-miss query.
- **Granted routine IDs.** The large custom plan used a parallel index-only walk of the routine PK and a hash join, with 11,000 matching grants read on each of three executions of the hash input. It used 549,990 shared buffer accesses fresh and up to 713,371 after growth. The same source and grant cardinalities drove both phases. The large generic plan and both small-viewer modes used the source/type grant index and one routine PK lookup per matched grant before deduplication. The stop refetch can repeat the full-index plan.
- **Top-level routine rows.** Both modes used the routine PK. The large custom plan used a bitmap heap lookup and the generic plan used an index scan. They fetched 5,000 matching IDs in 11.845–27.596 ms. Both small modes fetched 50. Work tracks the grant ID array, which has no SQL cap.
- **Active child rows.** Both modes used the active-child partial index and sorted only the matching active rows. The large parent array of 5,000 returned 130 rows fresh and 180 after growth in 0.825–1.167 ms. The small array of 50 returned 40 in both phases. No finished rows were scanned. The result size scales with the active children of the supplied parents.

## Fixture and method

| Seed | Fresh | After growth, before another analyze |
| --- | ---: | ---: |
| All routines | 1,000,000 | 1,100,000 |
| Top-level routines | 894,000 | 894,000 |
| Original large parent | 100,000 children | 100,000 children |
| Growth parent | 0 children | 100,000 children |
| Six smaller populated parents | 1,000 children each | 1,000 children each |
| Execution records | 2,852,535 | 2,957,525 |
| Entity access rows | 10,900,060 | 10,900,060 |
| Scheduled-action grants within entity access | 900,060 | 900,060 |
| Channel memberships | 245,550 total, 205,050 active | 245,550 total, 205,050 active |
| Team memberships | 20,002 | 20,002 |

Each populated large parent had 50 active children, 99,950 finished one-time children, 20,000 keyed copies and 5,000 distinct creating runs. Each smaller family had 20 active, 980 finished, 200 keyed and 50 creating runs. Two additional measured parents remained empty. Most top-level routines had three runs. The measured arrays included children with histories of 100,000, 25,000 and 10,000 records. Some routines had yet to run. [Fresh inventory](listq/fresh-inventory.log) · [Post-growth inventory](listq/stale-inventory.log)

The two viewers had 5,000 and 50 active channel memberships, respectively, with one team membership and one direct source each. Their channels, teams and direct grants overlapped. The resulting 11,000 and 110 grants deduplicated to 5,000 and 50 live IDs. All matched top-level rows were owned by the respective viewer and were cron routines. This keeps the full arrays in the owner-filtered scopes and yields identical bindings for both `include_events` settings. The `parent=` path binds only the parent UUID and `bigint` limit 200, so the other-viewer check reuses that child statement and measures the empty latest-run array left by the owner filter. [Fresh bindings](listq/fresh-bindings.jsonl) · [Post-growth bindings](listq/stale-bindings.jsonl)

Ran on scratch PostgreSQL 18.6 with editor migrations through `20261119085330`. SQLx verified the migration history and applied the 22 versions missing from the scratch server's template. All 855 entries succeeded. The six SQL bodies match `origin/main` at `12aaa9d4e02`. The fixture's 10.9M grant rows are near the lower end of the repository's 10–100M production tier. The repo's production configuration specifies PostgreSQL 14.22, so the timings and planner choices here are evidence for 18.6. [Migration log](listq/migrations.log) · [SQL comparison](listq/source-verification.log)

`VACUUM (ANALYZE)` established fresh statistics and visibility bits. Autovacuum was disabled on the five measured tables in the scratch database. The post-growth inventory shows the same `last_analyze` timestamps and catalog row estimates. Both phases used `random_page_cost = 1.1`, `work_mem = '16MB'` and `jit = off`, with a 15-second execution timeout for source lookup and a 60-second benchmark timeout for the other statements. The harness replayed the handler pipeline to capture downstream bindings before timing, then ran `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)` twice per forced mode and case. The first and repeat columns reflect that run order and include cache effects. [Seed SQL](listq/seed.sql) · [Growth SQL](listq/grow.sql) · [Measurement SQL](listq/measure.sql)

## Measurements

Buffers are root execution shared hits / reads in 8 KiB blocks. Time is execution milliseconds. Both columns show first → repeat. The JSON contains planning time and node-level buffers. `Latest runs` shows records found / probes, including probes for routines with no run. Parallel grant scan counts sum all process loops. There were no sequential scans or temp writes in the 200 measured plans. [Fresh plans](listq/fresh-plans.jsonseq) · [Post-growth plans](listq/stale-plans.jsonseq) · [Scan evidence](listq/scan-evidence.json)

| Plan label | Index |
| --- | --- |
| routine PK | `scheduled_action_pkey` |
| active child | `scheduled_action_active_children_idx` |
| parent/run | `scheduled_action_parent_run_idx` |
| latest run | `action_execution_record_action_id_idx` |
| grant source/type | `idx_entity_access_source_type_entity_plain` |
| active channel | `idx_comms_cp_active_by_user_channel` |
| team member PK | `team_user_pkey` |

### Fresh statistics

| Statement | Case | Plan and index | Rows | Buffers (hit/read) | Time (ms) |
| --- | --- | --- | --- | --- | --- |
| Children | 100k parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 39/17 → 56/0 | 0.158 → 0.113 |
| Children | 100k parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 56/0 → 56/0 | 0.091 → 0.110 |
| Children | 1k parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 27/12 → 39/0 | 0.134 → 0.095 |
| Children | 1k parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 39/0 → 39/0 | 0.079 → 0.074 |
| Children | 1k parent / small viewer · custom | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 24/13 → 37/0 | 0.120 → 0.086 |
| Children | 1k parent / small viewer · generic | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 37/0 → 37/0 | 0.105 → 0.082 |
| Children | empty parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 2/1 → 3/0 | 0.027 → 0.013 |
| Children | empty parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 3/0 → 3/0 | 0.012 → 0.008 |
| Children | empty parent / small viewer · custom | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 2/1 → 3/0 | 0.018 → 0.010 |
| Children | empty parent / small viewer · generic | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 3/0 → 3/0 | 0.011 → 0.008 |
| Children | growth parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 3/0 → 3/0 | 0.014 → 0.012 |
| Children | growth parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 3/0 → 3/0 | 0.010 → 0.008 |
| Latest runs | top-level / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 4737 / 5000 probes | 14956/4781 → 18877/860 | 28.179 → 13.234 |
| Latest runs | top-level / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 4737 / 5000 probes | 19737/0 → 19737/0 | 11.249 → 11.377 |
| Latest runs | all-active / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 4850 / 5130 probes | 20084/156 → 20240/0 | 11.789 → 11.283 |
| Latest runs | all-active / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 4850 / 5130 probes | 20240/0 → 20240/0 | 11.686 → 11.641 |
| Latest runs | top-level / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 48 / 50 probes | 160/38 → 198/0 | 0.215 → 0.091 |
| Latest runs | top-level / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 48 / 50 probes | 198/0 → 198/0 | 0.076 → 0.069 |
| Latest runs | all-active / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 82 / 90 probes | 302/50 → 352/0 | 0.278 → 0.137 |
| Latest runs | all-active / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 82 / 90 probes | 352/0 → 352/0 | 0.126 → 0.124 |
| Latest runs | 100k parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 244 / 250 probes | 845/149 → 994/0 | 2.335 → 0.517 |
| Latest runs | 100k parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 244 / 250 probes | 994/0 → 994/0 | 0.397 → 0.352 |
| Latest runs | 100k parent / other viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.017 → 0.005 |
| Latest runs | 100k parent / other viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.004 → 0.003 |
| Latest runs | 1k parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 734/143 → 877/0 | 0.771 → 0.450 |
| Latest runs | 1k parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 877/0 → 877/0 | 0.377 → 0.312 |
| Latest runs | 1k parent / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 726/151 → 877/0 | 0.837 → 0.439 |
| Latest runs | 1k parent / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 877/0 → 877/0 | 0.375 → 0.342 |
| Latest runs | empty parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.008 → 0.005 |
| Latest runs | empty parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.004 → 0.003 |
| Latest runs | empty parent / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.010 → 0.007 |
| Latest runs | empty parent / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.014 → 0.004 |
| Latest runs | growth parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.006 → 0.005 |
| Latest runs | growth parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.004 → 0.003 |
| Viewer source IDs | large viewer · custom | Append → Index-only active channel → Index-only team member PK → Result | 5002 sources | 4/59 → 63/0 | 1.047 → 0.885 |
| Viewer source IDs | large viewer · generic | Append → Index-only active channel → Index-only team member PK → Result | 5002 sources | 63/0 → 63/0 | 0.843 → 0.828 |
| Viewer source IDs | small viewer · custom | Append → Index-only active channel → Index-only team member PK → Result | 52 sources | 0/9 → 9/0 | 0.086 → 0.028 |
| Viewer source IDs | small viewer · generic | Append → Index-only active channel → Index-only team member PK → Result | 52 sources | 9/0 → 9/0 | 0.044 → 0.020 |
| Granted routine IDs | large viewer · custom | Unique → Gather Merge → Sort → Hash Join → Parallel Index-only routine PK → Hash → Index-only grant source/type | 5000 / 5002 source IDs, 33000 grant rows read, 1000000 routine rows checked | 548174/1816 → 549990/0 | 166.665 → 186.858 |
| Granted routine IDs | large viewer · generic | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 5000 / 5002 source IDs, 11000 grant rows read, 11000 routine rows checked | 58286/0 → 58286/0 | 54.952 → 53.690 |
| Granted routine IDs | small viewer · custom | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 50 / 52 source IDs, 110 grant rows read, 110 routine rows checked | 490/102 → 592/0 | 0.744 → 0.399 |
| Granted routine IDs | small viewer · generic | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 50 / 52 source IDs, 110 grant rows read, 110 routine rows checked | 592/0 → 592/0 | 0.296 → 0.278 |
| Top-level rows | large viewer · custom | Bitmap heap → Bitmap index routine PK | 5000 / 5000 IDs | 9257/5000 → 13512/745 | 27.106 → 15.515 |
| Top-level rows | large viewer · generic | Index routine PK | 5000 / 5000 IDs | 14257/0 → 14257/0 | 13.243 → 11.845 |
| Top-level rows | small viewer · custom | Index routine PK | 50 / 50 IDs | 150/50 → 200/0 | 0.209 → 0.064 |
| Top-level rows | small viewer · generic | Index routine PK | 50 / 50 IDs | 200/0 → 200/0 | 0.061 → 0.054 |
| Active child rows | large viewer · custom | Sort → Index active child | 130 / 5000 IDs | 31/38 → 69/0 | 0.955 → 0.844 |
| Active child rows | large viewer · generic | Sort → Index active child | 130 / 5000 IDs | 69/0 → 69/0 | 0.825 → 0.857 |
| Active child rows | small viewer · custom | Sort → Index active child | 40 / 50 IDs | 1/21 → 22/0 | 0.103 → 0.040 |
| Active child rows | small viewer · generic | Sort → Index active child | 40 / 50 IDs | 22/0 → 22/0 | 0.034 → 0.028 |

### After growth, stale statistics

| Statement | Case | Plan and index | Rows | Buffers (hit/read) | Time (ms) |
| --- | --- | --- | --- | --- | --- |
| Children | 100k parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 39/18 → 57/0 | 0.179 → 0.129 |
| Children | 100k parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 57/0 → 57/0 | 0.108 → 0.092 |
| Children | 1k parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 28/12 → 40/0 | 0.146 → 0.091 |
| Children | 1k parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 40/0 → 40/0 | 0.081 → 0.081 |
| Children | 1k parent / small viewer · custom | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 24/14 → 38/0 | 0.156 → 0.089 |
| Children | 1k parent / small viewer · generic | Append → Index active child → Limit → Index parent/run backward | 220 (20 active + 200 finished), finished arm 213 candidates (13 filtered) | 38/0 → 38/0 | 0.080 → 0.080 |
| Children | empty parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 2/2 → 4/0 | 0.033 → 0.013 |
| Children | empty parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 4/0 → 4/0 | 0.013 → 0.009 |
| Children | empty parent / small viewer · custom | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 3/1 → 4/0 | 0.037 → 0.010 |
| Children | empty parent / small viewer · generic | Append → Index active child → Limit → Index parent/run backward | 0 (0 active + 0 finished), finished arm 0 candidates (0 filtered) | 4/0 → 4/0 | 0.011 → 0.009 |
| Children | growth parent / large viewer · custom | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 47/8 → 55/0 | 0.179 → 0.101 |
| Children | growth parent / large viewer · generic | Append → Index active child → Limit → Index parent/run backward | 250 (50 active + 200 finished), finished arm 226 candidates (26 filtered) | 55/0 → 55/0 | 0.094 → 0.089 |
| Latest runs | top-level / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 4737 / 5000 probes | 15083/4654 → 19641/96 | 28.055 → 13.721 |
| Latest runs | top-level / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 4737 / 5000 probes | 19737/0 → 19737/0 | 13.017 → 12.589 |
| Latest runs | all-active / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 4893 / 5180 probes | 20218/215 → 20433/0 | 13.938 → 13.464 |
| Latest runs | all-active / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 4893 / 5180 probes | 20433/0 → 20433/0 | 13.346 → 13.425 |
| Latest runs | top-level / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 48 / 50 probes | 159/39 → 198/0 | 0.285 → 0.118 |
| Latest runs | top-level / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 48 / 50 probes | 198/0 → 198/0 | 0.083 → 0.071 |
| Latest runs | all-active / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 82 / 90 probes | 302/50 → 352/0 | 0.310 → 0.159 |
| Latest runs | all-active / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 82 / 90 probes | 352/0 → 352/0 | 0.151 → 0.130 |
| Latest runs | 100k parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 244 / 250 probes | 845/149 → 994/0 | 1.035 → 0.608 |
| Latest runs | 100k parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 244 / 250 probes | 994/0 → 994/0 | 0.490 → 0.415 |
| Latest runs | 100k parent / other viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.007 → 0.005 |
| Latest runs | 100k parent / other viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.004 → 0.004 |
| Latest runs | 1k parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 730/147 → 877/0 | 1.017 → 0.512 |
| Latest runs | 1k parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 877/0 → 877/0 | 0.399 → 0.343 |
| Latest runs | 1k parent / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 726/151 → 877/0 | 1.091 → 0.606 |
| Latest runs | 1k parent / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 217 / 220 probes | 877/0 → 877/0 | 0.477 → 0.311 |
| Latest runs | empty parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.007 → 0.005 |
| Latest runs | empty parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.004 → 0.004 |
| Latest runs | empty parent / small viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.012 → 0.006 |
| Latest runs | empty parent / small viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 0 / 0 probes | 0/0 → 0/0 | 0.005 → 0.004 |
| Latest runs | growth parent / large viewer · custom | Nested Loop → Function Scan → Limit → Index latest run | 243 / 250 probes | 844/149 → 993/0 | 1.098 → 0.524 |
| Latest runs | growth parent / large viewer · generic | Nested Loop → Function Scan → Limit → Index latest run | 243 / 250 probes | 993/0 → 993/0 | 0.394 → 0.358 |
| Viewer source IDs | large viewer · custom | Append → Index-only active channel → Index-only team member PK → Result | 5002 sources | 4/59 → 63/0 | 0.999 → 0.878 |
| Viewer source IDs | large viewer · generic | Append → Index-only active channel → Index-only team member PK → Result | 5002 sources | 63/0 → 63/0 | 0.835 → 0.821 |
| Viewer source IDs | small viewer · custom | Append → Index-only active channel → Index-only team member PK → Result | 52 sources | 0/9 → 9/0 | 0.122 → 0.037 |
| Viewer source IDs | small viewer · generic | Append → Index-only active channel → Index-only team member PK → Result | 52 sources | 9/0 → 9/0 | 0.035 → 0.022 |
| Granted routine IDs | large viewer · custom | Unique → Gather Merge → Sort → Hash Join → Parallel Index-only routine PK → Hash → Index-only grant source/type | 5000 / 5002 source IDs, 33000 grant rows read, 1100000 routine rows checked | 702096/11249 → 707960/5411 | 226.282 → 227.767 |
| Granted routine IDs | large viewer · generic | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 5000 / 5002 source IDs, 11000 grant rows read, 11000 routine rows checked | 50786/7500 → 58284/2 | 72.976 → 55.054 |
| Granted routine IDs | small viewer · custom | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 50 / 52 source IDs, 110 grant rows read, 110 routine rows checked | 512/80 → 592/0 | 0.860 → 0.477 |
| Granted routine IDs | small viewer · generic | Unique → Sort → Nested Loop → Index-only grant source/type → Index-only routine PK | 50 / 52 source IDs, 110 grant rows read, 110 routine rows checked | 592/0 → 592/0 | 0.384 → 0.307 |
| Top-level rows | large viewer · custom | Bitmap heap → Bitmap index routine PK | 5000 / 5000 IDs | 9565/5025 → 14587/3 | 27.596 → 13.568 |
| Top-level rows | large viewer · generic | Index routine PK | 5000 / 5000 IDs | 14590/0 → 14590/0 | 13.687 → 13.230 |
| Top-level rows | small viewer · custom | Index routine PK | 50 / 50 IDs | 150/50 → 200/0 | 0.290 → 0.079 |
| Top-level rows | small viewer · generic | Index routine PK | 50 / 50 IDs | 200/0 → 200/0 | 0.069 → 0.075 |
| Active child rows | large viewer · custom | Sort → Index active child | 180 / 5000 IDs | 26/69 → 95/0 | 1.167 → 0.929 |
| Active child rows | large viewer · generic | Sort → Index active child | 180 / 5000 IDs | 95/0 → 95/0 | 0.931 → 0.900 |
| Active child rows | small viewer · custom | Sort → Index active child | 40 / 50 IDs | 2/20 → 22/0 | 0.130 → 0.046 |
| Active child rows | small viewer · generic | Sort → Index active child | 40 / 50 IDs | 22/0 → 22/0 | 0.044 → 0.031 |

## Verification and cleanup

Both modes and both repetitions were present for all 25 statement/case pairs per phase. Cardinalities and latest-run loop counts matched the fixture. The hot run-history ID was present in the large per-parent and all-active bindings in both phases. The scratch database `listq_fcac6ea103cd` was dropped and its absence was verified. [Case verification](listq/verification.json) · [Hot binding check](listq/hot-binding-verification.log) · [Drop verification](listq/cleanup.log)
