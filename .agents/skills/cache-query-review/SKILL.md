---
name: cache-query-review
description: Measure what a change's queries against the on-device GraphQL cache engine cost, at N and 2N, and put the table in the PR. The review skill runs it before a push; use it directly when a diff adds or changes a cache query (a live query, `entityFilter`, `readRecordsByKeys`, a search, or cache-turso SQL), its limit, sort, filter or selection, a hook that builds the IDs or filter one reads, or a list that renders its results.
---

# Cache query review

Chat's sidebar once held about seven times its channel list in memory and
re-ran its reads on every cache write. Its by-ID lookups read up to 500
channels at a time through an index, which a review of the query alone
passes. The call site was the problem. It built its ID set by collecting
every section's channel IDs, so the work grew with the account rather than
with the screen, and every write re-ran all of it.

So this review has two parts, both with numbers: the engine query (Part A) and
the call site (Part B). It covers dynamic queries too, whose filter or ID set
is built at run time, because that is where the sidebar's cost was.

Paths below starting `lib/` or `features/` are under `apps/web/src`.

## 1. List what changed

Read the whole diff. These commands only find leads; a cache query can change
in a file neither of them names (a component that filters cached rows, a
GraphQL fragment's selection):

```sh
base_ref=origin/main                 # for a stacked PR, the branch it is based on
base=$(git merge-base HEAD "$base_ref")
git diff --name-only "$base" HEAD -- crates/client apps/web/src/lib/graphql-cache apps/web/src/lib/queries \
  'apps/web/src/features/*/queries.ts' 'apps/web/src/features/**/queries/**' 'apps/web/src/**/*.graphql'
git diff "$base" HEAD -- 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.graphql' \
  | grep -nE '^[+-].*(createLiveQuery|createPredicateQuery|createKeyedProjection|useCachedChannelsByIds|entityFilter|readRecordsByKeys|useSoupAstItemsQuery|liveQuery|filters?:|limit:|sort(Method|By)?:|channelIds|entityIds)'
```

A cache query changed when any of these did:

- its SQL in `crates/client/cache-turso` (or the planner in `cache-core` that
  picks it), including one fragment of assembled SQL;
- its document, fragment, selection, filter shape, sort or limit in the web
  app;
- its inputs: an ID list or OR filter built from more than before (a section
  to every section, a page to a collection);
- how often it runs: a new mount, a new reader of the same query, a memo or
  effect that re-reads it, or a reader that now re-runs on a cache change;
- what a list does with its results: how many rows it resolves or filters,
  and how much each one allocates.

## 2. Part A: the engine query

For each changed query, at N and 2N:

1. **Plan:** index or scan.
2. **Work:** VM steps, and records returned.
3. **Limit or window**, and why there is none if there is none.
4. **Time** to the first result, and to the update after one row changes.
5. **The largest ID list or OR filter** it is given, and in how many batches.

Where to get each:

- **SQL in cache-turso.** Write a cost test beside the others
  (`src/storage/test/predicate_cost.rs`, `search_bucket_cost.rs`,
  `conjunction_cost.rs`): seed an in-memory `TursoStorage` at N and 2N rows,
  read `EXPLAIN QUERY PLAN` for the statement (as
  `src/storage/people_sql/test.rs` does), and assert
  `statement.metrics().vm_steps` under a budget at both sizes. VM steps count
  the statement's own work, rows it scanned and skipped included, and are the
  same on every machine and build profile, so the test can fail CI; wall time
  cannot.
- **Read time.** `crates/client/cache-bench` replays production-size datasets
  in the native engine and in a browser on OPFS (its `AGENTS.md` has the
  recipes) and times a fixed list of reads in each replay (native
  `apps/web/tauri/graphql_cache_plugin/src/engine/test/bench.rs`, browser
  `lib/graphql-cache/worker/browser-test/bench-harness.ts`). To time a new
  read, add it to both. Its tiers hold 10, 40 and 400 channels and change
  the other entity counts with them, so no two tiers are N and 2N: report
  the time at a tier's own size and leave growth to the cost test and the
  call-site test.
- **After it ships.** The browser engine reports each statement slower than
  200 ms as the `graphql_cache.slow_query` span and log, keyed by
  `db.query.fingerprint`: search logs for
  `service:web-app "graphql_cache.slow_query"` and group by
  `@db.query.fingerprint`. Native hosts report nothing. The fingerprint is
  the FNV-1a hash of the statement's unexpanded SQL text
  (`fingerprint` in `cache-turso/src/query_telemetry.rs`, private to that
  module): to find which statement one is, hash the statement's exact
  template the same way in a test inside that module. The template text
  itself (`@db.query.text`) exists only once
  [#12372](https://github.com/macro-inc/macro/pull/12372) is merged and
  deployed, never from clients older than that deploy, and even then only
  on some events and, for a long template, as an excerpt that does not
  hash back to its fingerprint, so keep the fingerprint lookup. Read only; never send requests to production to make
  a query slow.

## 3. Part B: the call site

Part A alone passes the sidebar bug. Answer these at N and 2N, where 2N adds
records no first page shows, so a count that moves between the sizes follows
the account:

1. **Bounded?** Does the ID list, filter or result grow with the account or
   only with what is on screen?
2. **Fetched versus rendered.** Records the query returned against the
   rows it renders, and for the page, rows the server returned against rows
   mounted.
3. **Blast radius of a write.** What the query reads again after a write no
   list shows, and after one row changes.
4. **Scaling.** At 2N, does any count more than double?
5. **Reactive cost.** A mapper that walks store proxies inside a tracking
   scope makes a signal per field it touches.

Where to get each:

- **A test of the call site, for every changed query.** Over a fake source
  of N and 2N records (fake sources per FE-33), count the query's inputs
  (IDs, OR terms, batches), the records it returns, the rows the list
  renders from them, and its read calls through a write no list shows and
  through a one-row update. This is the only source for 3, and for reads
  the cache answers without the network.
- **Chat.** The Chat scale tier (`apps/web/tests/chat-scale`, its
  `AGENTS.md`) runs the built app in Chromium over a stub backend at 3,500
  and 7,000 channels, with sections that hold most of the account and a
  saved collapse state. For each step (seed, cold open, a message, a scroll,
  a section collapsed and expanded) its `results.json` has requests by
  GraphQL operation, rows the step asked the server for and got back,
  channel IDs its by-ID reads named, heap after garbage collection, DOM
  nodes, long tasks, and the rows mounted when the step settled. Its
  server counts are totals over every query in the step (`coldOpen`
  includes the channel lane's whole refresh pass), so they say nothing
  about one query alone: compare a step with the same step on the base,
  at `coldOpen` for loads, and take per-query counts from the call-site
  test. Both checkouts need the tier (`apps/web/tests/chat-scale` and the
  `build-chat-scale` and `test-chat-scale-browser` recipes in
  `apps/web/justfile`); when the change edits the tier, copy its
  `apps/web/tests/chat-scale` into the base checkout, so the runs differ
  only in the app.
- **Reactive cost.** Read the mapper against the query-result rule in
  `.agents/rules/web/solid.md` (FE-70 there): a walk of a large result reads
  `unwrap(query.data)` when the query replaces its data on update; a query
  that reconciles rows in place keeps its reads tracked, or, for Soup
  `LiveQuery` and `createPredicateQuery` rows, walks
  `readRowSnapshot(record)`.

Nothing here measures the time from a write to the updated row on screen.
Say so when it matters, and say which of 1 to 5 a change left unmeasured.

## 4. Fail conditions

Two kinds, reported apart.

**CI fails** on:

- a cache-turso cost test over its VM-step budget, in the Rust tests;
- the Chat scale tier's checks: in `apps/web/tests/chat-scale/limits.ts`,
  ceilings on heap, DOM nodes, long tasks and time to the first rows at
  each size, and limits on how much heap, DOM nodes and long tasks grow
  from N to 2N; and each step doing what it is named for. It runs nightly and by hand, not on PRs, so run it yourself on
  a change to Chat's data path.

**Review findings**, each fixed or justified in the PR body:

| Finding | Seen as | Source |
| --- | --- | --- |
| A list query has no limit or window | a limit as large as the collection, or batches that together read all of it; SQL with no `LIMIT` and no window bound | the code; a cost test |
| An ID set is built over a whole collection | its size or batch count grows from N to 2N | the code; the call-site test |
| Fetched rows are more than a small multiple of rendered rows | a query's records over about 3× the rows it renders | the call-site test |
| A query re-runs after an unrelated write | a read call after a write no list shows | the call-site test |
| A count grows faster than the data | over 2× from N to 2N | any of them, compared like for like |
| A page step costs more than on its base | heap, long tasks, server rows or IDs read by ID up at a step against the same step on the base | the Chat scale tier |
| A mapper walks nested arrays of a reactive record under tracking | `query.data` walked in a tracked scope where the rule asks for `unwrap` or `readRowSnapshot` | the code |

A finding is closed by a code change or a number, never by rewording.

## 5. Check for these by name

- `useCachedChannelsByIds` (`lib/queries/channel/by-ids.ts`) fed from a
  `flatMap` over labels or sections: an ID set over the whole account.
- `createKeyedProjection` (`lib/queries/soup/create-keyed-projection.ts`)
  whose mapper walks the tracked record instead of a `readRowSnapshot`
  snapshot.
- A `createMemo` that maps a whole collection and walks `participants`.
- A list that reads a search-sized page (Quick Access searches ask for 500,
  `SEARCH_LIMIT` in `lib/core/context/quickAccess/projected-list.ts`) to show
  a screenful.

## 6. Report

Put one table in the PR body under `## Cache query review`, one row per
query the change touches, worst first. Each cell gives N → 2N; write `not
measured` where no source gave a number. The row below shows the format
only: its query is made up and its numbers are invented, so never copy
them as evidence.

| Query | Plan | VM steps | Limit | Largest ID list or OR filter (batches) | Records returned | Rows rendered | Reads after an unrelated write | Reads after a one-row update | First result / update | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `useCachedWidgetsByIds` (an example) | `records` primary key | not measured | 500 a batch | 500 (2) → 500 (4) | 1,000 → 2,000 | 40 → 40 | 0 → 0 | 1 → 1 | not measured | measured: a call-site test at 3,500 and 7,000 (example) |

State each row's evidence:

- **`measured`**: name what ran it and at which sizes (a cost test, a
  call-site test, cache-bench). The Chat scale tier's step totals go under
  the table, not in a query's row.
- **`reasoned`**: nothing runs it yet. Say what would measure it and leave
  the row open; a row that would be a finding in section 4 cannot close as
  `reasoned`.

Under the table, give the Chat scale tier's `coldOpen` numbers for the
change and its base when it ran (heap, long tasks, server rows asked and
returned, IDs requested, rows mounted), list CI failures apart from review
findings, and say what section 3 left unmeasured for this change.
