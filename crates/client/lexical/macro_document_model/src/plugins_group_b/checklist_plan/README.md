# Checklist planning

`plan_checklist(meta, tasks, names, calendar)` is a pure bulk computation. It
installs no query, listener, timer, state writer, WASM export or FFI method;
metadata collection belongs to `checklist_controls`.

Inputs are collected metadata, externally resolved task properties and names,
and raw host calendar observations. Maps serve lookups only; output items and
rows keep input order and duplicates. Nonempty task assignments replace inline
assignees; unknown names become `Unknown`, empty resolved names stay empty.
Nullish task dates fall back to mention dates; empty strings override them.
Unknown option IDs fall back to checkbox/marker facts.

Filters OR choices within a category and AND categories. Filters dim rows
without removing them or changing progress. Progress ignores empty text and
counts checked items or tasks whose status is done/canceled; an empty list is
zero percent. `has_tasks` is `taskId !== null`, including legacy absent values.

## Calendar facts

A `DateObservation` carries epoch milliseconds, local Gregorian fields and the
result of cloning the Date and calling `setHours(0,0,0,0)`. An invalid parsed
date and a valid date with an invalid midnight are distinct; the latter puts the
item in the `later` bucket. Rust reproduces date-fns 4.4.0 arithmetic exactly
(UTC constructor year remap, millisecond zone offsets, JavaScript rounding).
Never infer local midnight from civil fields, subtract UTC dates or truncate
offsets to minutes. Missing or invalid observations return `InvalidCalendarFacts`.

## Unsupported input

Noncanonical settings, and reserved `Object.prototype` keys in referenced task,
status or priority IDs, return `UnsupportedInput` for the whole result with the
raw settings unchanged; no partial plan is produced. Names use `Map.get`
semantics and are not restricted.

## Regenerating fixtures

`packages/lexical-conformance/corpus/checklist-plan-source.mjs` runs the web editor's checklist `model.ts` and property
modules unchanged against `source-inputs.json`, verifying file hashes first.
Run it from the repository root against a checkout of this repository at the
`sourceCommit` recorded in the fixtures, with its dependencies installed
(`git worktree add <dir> <sourceCommit>`, then `bun install` there), once per
committed time zone:

```sh
SOURCE_CHECKLIST_ROOT=/path/to/checkout TZ=UTC bun packages/lexical-conformance/corpus/checklist-plan-source.mjs crates/client/lexical/macro_document_model/src/plugins_group_b/checklist_plan/source-utc.json
```

Repeat with `TZ=America/New_York`, `Europe/Prague` and `Pacific/Kiritimati` for
the other `source-*.json` files. `test.rs` compares native output with all four.
