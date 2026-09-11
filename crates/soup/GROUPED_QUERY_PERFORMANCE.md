# Grouped REST Soup query performance

Scope: `POST /items/soup/ast/grouped`, outbound PostgreSQL adapter only.
No API, permission policy, enrichment scheduling, migration, or index changes.
Exact counts still process every match (after the cursor) and intentional property
fanout. Initial pages retain ten rows **per group**, with no global limit.

## Reproduce safely

Run from the repository root, with the Nix shell's local-only `DATABASE_URL`
verified as `localhost:5432/macrodb`. Never use hosted data. SQLx creates isolated
migration-backed test databases and loads `mixed_items_expanded.sql`.

```sh
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p soup --features outbound outbound::pg_soup_repo::grouping::test'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p soup --features outbound grouped_query_explain_local -- --ignored --nocapture --test-threads=1'
nix develop --command bash -c 'unset SQLX_OFFLINE; cargo test -p soup --features outbound'
nix develop --command just prepare_db
nix develop --command bash -c 'unset SQLX_OFFLINE; just sqlx::prepare_db "$DATABASE_URL" --tests'
nix develop --command just check
```

This machine needed `TMPDIR=$HOME/.cache/soup-nix-tmp` both outside and inside
Nix, and `RUSTC_WRAPPER=` inside Nix, because the existing sccache server used a
quota-exhausted `/tmp`. No database reset or volume deletion was performed.

## Workload and measurement

Measured locally on PostgreSQL 18.6, 2026-09-11. Baseline production revision:
`da58e757`. T01 change: `rztnqpwk` (semijoins).

The ignored diagnostic generates the **actual grouped SQL** and mirrors all
production bind slots and `.persistent(false)`. It adds 12,000 UUIDv7 documents,
120 of them tasks, and 24,000 access grants (direct plus inherited), to the mixed
fixture (6 documents, 5 chats, 5 projects, 15 grants, 7 history rows). New documents
have created timestamp `2026-01-01` and updated timestamp `2026-01-02` UTC.
`ANALYZE` runs after seeding; no planner settings are forced.

Four shapes, each with UpdatedAt and ViewedUpdated, three repetitions each:

- Selective tasks: task subtype, other entity arms excluded; entity-type groups.
- Broad mixed: no AST filters; document-heavy mixed corpus, entity-type groups.
- Property initial: selective tasks grouped by assignees; synthetic values are
  unset. Multivalue fanout is covered separately by the pagination regression.
- Continuation: selective tasks, group `document`, cursor at updated timestamp
  and generated ID at offset 60; 60 remaining matches, limit 50.

Common binds: fixture caller `macro|user-1@test.com`, effective sort string,
limit 50, null cursor fields except continuation, existing completed/status/
assignees system IDs, null group key except continuation. No optional entity-type
bind in the measured property query (see baseline bug below).

Each sample is `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)`. Timings below
are execution medians in milliseconds, **not endpoint latency**. All samples had
zero shared reads and zero temporary writes; caches were warm from seeding.
UUIDs differ between isolated runs but cardinalities and cursor rank are equal.
Three repetitions on one local machine do not establish a universal speedup.

## T01: access semijoins

| Shape | Sort | Baseline ms | T01 ms | Baseline/T01 shared hits (last sample) |
| --- | --- | ---: | ---: | ---: |
| Selective tasks | UpdatedAt | 11.595 | 3.207 | 822 / 911 |
| Broad mixed | UpdatedAt | 176.775 | 126.401 | 48602 / 671 |
| Property initial | UpdatedAt | 10.492 | 2.415 | 1062 / 762 |
| Continuation | UpdatedAt | 10.418 | 3.228 | 1172 / 811 |
| Selective tasks | ViewedUpdated | 10.452 | 3.477 | 942 / 912 |
| Broad mixed | ViewedUpdated | 178.648 | 126.545 | 48611 / 680 |
| Property initial | ViewedUpdated | 10.660 | 2.527 | 1182 / 763 |
| Continuation | ViewedUpdated | 10.646 | 2.514 | 1292 / 812 |

Baseline selective-task access scanned 24,007 document grants and materialized
12,005 distinct accessible document IDs. T01 instead used 120 index probes on
`idx_entity_access_entity_text_type_source` (one matching grant per probe).
The broad query can still choose access-set hashing. This is planner freedom,
not an assertion that candidate-first execution is always best.

The total number of Sort nodes was unchanged: four for task-only shapes and
five for broad mixed (including detail lookups). Planning times ranged
0.845–1.905 ms before and 1.259–2.615 ms after. Counts, ranks, fanout, returned
IDs, and cursor pages are asserted by regressions, not inferred from timings.

Local raw logs: `$HOME/.cache/soup-checks/t01-before.log` and `t01-after.log`.
They contain every JSON plan and individual timing; the diagnostic reproduces
the measurements without relying on those machine-local files.

### Verification and bounded deviations

- Grouping characterization: 20 tests passed before and after T01; access
  structural test and ignored diagnostic passed after T01.
- Added exact user/channel/team/inherited access, duplicate-grant and denial
  checks, ownership-without-grant and deleted-task exclusion, calendar owner/
  link visibility, canonical task coverage, multi-assignee fanout, unset values,
  tied cursor pages, remaining counts and frecency exclusion.
- Existing optional property `entity_type` grouping fails before optimization:
  `$10` is bound as text but compared directly with `property_entity_type`
  (SQLSTATE 42883). The regression characterizes this unchanged failure rather
  than silently fixing a separate API bug; successful optional-bind pagination
  evidence is therefore blocked. Canonical TASK matching without that bind works.
- `just check` exits zero but does **not** check this non-colocated jj workspace:
  its Git discovery fails and it reports “no changed files”. This is not a pass.
  Changed Rust files passed direct Nix rustfmt and the gate's pinned
  `@ast-grep/cli@0.44.1 scan --report-style=short` rules.
- Workspace `just prepare_db` and the `--tests` helper both passed. Only the 14
  generated cache entries attributable to new setup/diagnostic macros are kept;
  unrelated cache additions were restored. No cache entries were hand-edited.
- Grouping tests passed again after cache preparation (20/20).
- Full outbound package: 212 passed, zero failed, one ignored diagnostic;
  doc tests passed (zero cases). Used `--test-threads=2` to bound concurrent
  migration work. An earlier 120-second tool invocation was interrupted;
  the background rerun completed in 435 seconds.

SQL review: production SQL remains genuinely AST/grouping-dependent; the new
access fragments reuse trusted constant identifiers and existing bound source
membership. New static setup queries use compile-time SQLx macros. The ignored
EXPLAIN uses dynamic SQL with production binds. The hexagonal boundary is
unchanged: the outbound repository implements existing visibility rules; domain
policy and inbound authorization remain where they were.
