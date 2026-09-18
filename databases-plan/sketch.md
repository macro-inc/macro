# Macro Databases — sketch

This folder is the working plan for Macro Databases. This file is the overview and index;
each piece has its own doc.

## What we're building

A new top-level primitive: a **database** — a collection of tables, presented to users as
"just a table" (tabs within one database block). Databases cover the fat tail of use cases
we won't build bespoke modules for (applicant trackers, party planning, vendor lists). CRM
and Tasks stay best-in-class separate modules — visually similar, deliberately not merged
("we must resist elegance").

What makes ours more capable than Notion's:

1. **Rows can be Macro entities** — people, documents, calls, companies, email threads:
   real entities with permissions, hovercards, click-through.
2. **SQL is the query surface** — live query chips, query-backed views, and charts on any
   lexical surface. AI writes most of the SQL; it stays inspectable.
3. **Magic tables** expose Macro's own data (`people`, `documents`, `tasks`, `calls`, …)
   to SQL, permission-scoped per viewer, so user tables join against the platform.

Interactive mock of the whole surface:
https://claude.ai/code/artifact/635f0600-3d70-4a70-8564-f37af63042aa

## The architecture in one paragraph

Postgres stores it, `entity_access` guards it, a per-query **ephemeral in-memory SQLite**
runs it. Cells store typed entity ids only (`usr_…`, `doc_…`); display data is hydrated at
read time (chips in the UI, magic-table joins in SQL). Query chips persist the query,
never results — every viewer re-executes as themselves, which makes liveness and
permissions correct by construction. No Turso, no per-user SQLite files, no user SQL ever
touching Postgres.

## Doc map

| doc | covers |
|---|---|
| [backend-implementation.md](backend-implementation.md) | the full Rust shape: crate layout, ports, query pipeline, routes, entity plumbing, PR-sized phases |
| [storage.md](storage.md) | Postgres schema, JSONB cells vs EAV, columns as property bindings, entity plumbing checklist |
| [query-engine.md](query-engine.md) | ephemeral SQLite lifecycle, authorizer-driven deps, type mapping, `HAS` sugar, guardrails, why not Turso |
| [magic-tables.md](magic-tables.md) | per-entity table contracts, blessed queries, column-level lazy materialization, permission scoping |
| [frontend-block.md](frontend-block.md) | block registration, hand-rolled grid on property editors, bare rows, inferred type restriction, filter-pills-are-SQL |
| [links-and-lookups.md](links-and-lookups.md) | link columns (two-way, junction-backed), row chips + picker, lookups/rollups, "JOIN appears exactly once" |
| [lexical-nodes.md](lexical-nodes.md) | query chip / query block / view / chart / embed node schemas, transformers, insertion, rendering discipline |
| [sql-editor.md](sql-editor.md) | CodeMirror extension suite, chips-in-SQL, styles-of-magic comparison (joins vs functions vs arrows), agent authoring UX |
| [liveness.md](liveness.md) | version counters → gateway invalidation, per-viewer re-execution, local echo, magic-table tiers |
| [permissions.md](permissions.md) | shared-viewer semantics (the decide-early doc), edit levels, hydration ownership |

## Explicitly punted

- **Kanban** (and any non-table view renderer) — the grouping/write-back model isn't
  fleshed out; revisit post-v1.
- Projects integration (v1 is user-global scope); folders-as-databases (do the cheap
  "view folder as table" experiment first); template marketplace; Notion DB import.
- Workflows: code as substrate, AI as authoring UI, triggers (row added / column changed /
  cron / slash command) — likely bots + SDK (`macro.dbs.byName(...)`), run log as the
  trust surface. Own doc when we get there.
- SDK/app persistence for AI-generated blocks: per-app SQLite — DO SQLite (sync-service
  precedent) before Turso; entity databases exposed into that runtime as magic tables via
  the same materializer.
- Write-through SQL (updatable views), deep magic-table invalidation, persistent/cached
  SQLite — only if profiling demands.

## Open questions (cross-doc)

- Shared-database viewer semantics for inaccessible referenced entities — see
  [permissions.md](permissions.md); constrains the membership model, decide early.
- ~~Which style of magic for hand-written SQL~~ — **decided: explicit magic-table joins
  only** (functions/arrows rejected; arrows collide with SQLite's JSON `->`). See
  [sql-editor.md](sql-editor.md).
- Naming: users only ever see "table"; launcher letter (`b`? `t`?).
- Where the query endpoint lives (start in document_storage_service, extract later).
- Rate/size limits for chips (per-doc query budget, result row caps).
