# Checklist planning

`plan_checklist(meta, tasks, names, calendar)` is a pure, explicitly requested
bulk computation. It installs no query, listener, timer, state writer, WASM export
or FFI method. Collection remains owned by `checklist_controls`; its committed
metadata prerequisite is `879a9c6091` (canonical child identical to `622ff9dea6`).
The model registration order remains unchanged.

Inputs are actual collected metadata, externally resolved task properties and
names, and raw host calendar observations. Maps serve lookups only. Output items
and leading/item/attached rows preserve input order and duplicates. Nonempty task
assignments replace inline assignees; unknown names become `Unknown`, while empty
resolved names remain empty. Nullish task dates fall back to mention dates;
empty strings override them. Unknown option IDs fall back to checkbox/marker
facts. The option identifiers match the pinned Source property catalog.

Filters OR choices within a category and AND categories, preserving unknown
strings and duplicate choices. A nonempty assignment list containing nullish IDs
does not become `unassigned`. Filters dim rows without removing them or changing
progress. Progress ignores exact empty text and counts checked items or tasks
whose effective status is done/canceled. The ratio and rounded percentage follow
the Source bar, including zero percent for an empty list. `has_tasks` follows the
actual caller's `taskId !== null` expression, including legacy absent values;
do not derive it from a separate per-item classification API.

## Raw calendar facts

A `DateObservation` carries actual integer epoch milliseconds, local Gregorian
fields, and the observed result of cloning that Date and calling
`setHours(0,0,0,0)`. A parsed invalid date and a valid date with an invalid
normalized midnight are distinct. The latter is supported: Source calendar-day
arithmetic becomes NaN and its due bucket falls through to `later`.

Rust validates Gregorian/time fields and TimeClip instant bounds, then reproduces
the actual date-fns 4.4.0 operations: UTC constructor normalization (including the
0..99 year remap), `setUTCFullYear` recovery from an invalid Date, millisecond
zone-offset arithmetic and JavaScript rounding. This preserves year-zero leap
behavior, the full JavaScript Date range, historical offset seconds and DST.
Do not infer local midnight from civil fields, subtract UTC dates, truncate
zone offsets to minutes or apply a modern offset cap. Calendar facts are
host-owned observations; these representation checks do not certify an IANA
zone or replace the host's responsibility to observe a Source-compatible parser.
Missing required parse observations and invalid raw representations return
`InvalidCalendarFacts`. Due observations are requested only after earlier filter
categories match; invalid parsed dates produce the `none` bucket.

## Explicit coverage

`Planned` supports missing/null settings and filters containing string arrays
whose array fields may be missing/null. `UnsupportedInput` retains the same
unmodified raw settings `Arc<Value>` for noncanonical shapes. Reserved Object.prototype keys
in referenced task IDs and status/priority option IDs also return this coverage
result, including valid own reserved task properties. For external fact gaps,
the retained raw settings are context, not a claim that they contain the bad
fact. The initial identifier domain excludes those collisions. Unknown ordinary
IDs retain their normal fallbacks. Names use the actual caller's `Map.get`
semantics; they and filter-choice strings do not inherit this restriction. The
whole result is unsupported; no unsupported row is skipped to produce a partial
plan. It is a coverage result, not a Source exception, a normalized default or an empty plan. Source accepts some of
those shapes: a string status has count 4, scalar status 42 gives NaN/inactive,
and an object with length 1 throws TypeError. The fixtures preserve these distinct
outcomes without encoding NaN as JSON null. Coverage/activation for these
Source-accepted malformed cases remains open. Do not change the state parser,
drop publication receipts or claim full document parity from this producer.
Missing metadata uses actual Source empty defaults; unknown collection coverage
must not be relabeled as known missing metadata by an adapter.

## Source reproduction

`source-probe.mjs` imports the unchanged pinned Source `model.ts` and property
modules from commit `34959817b73c6d30e1b768320120f77865dcd352` using its actual web
configuration. It verifies file hashes before execution. It also isolates the
pinned caller's unchanged items/hasTasks memos, Map name resolver and percentage
function bodies through AST shape checks, supplying plain data accessors. This does not construct or
render the component. No editor, fake node, runtime stub, source rewrite or
Vite app cache participates. Library helper hashes and runtime identity are
recorded with the outputs.

Run from the repository root with an immutable checkout/snapshot containing those
Source files, its unchanged web tsconfig, and lock-matched dependencies:

```sh
SOURCE_CHECKLIST_ROOT=/path/to/source TZ=UTC bun crates/client/lexical/macro_document_model/src/plugins_group_b/checklist_plan/source-probe.mjs /tmp/checklist-source-utc.json
```

The committed outputs cover UTC, New York, Prague and Kiritimati. Native tests
compare the complete supported outputs and preserve explicit unsupported cases,
including Min/Max Date, leap years 0/4/96/99, DST, historical seconds, actual
invalid-midnight behavior and UTC setter revival. The civil-only minimum-Date
comparison was executed RED before the raw-observation refinement.

These are pure Source/native component results. Task fetching, a coherent native
artifact, transport DTOs, runtime query/FFI installation, UI lifecycle/access and
rendered task-list behavior need their own integration proof.
