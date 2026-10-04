# Testing optimistic live queries

The cache is suitable for model-based property testing: generate valid operations,
run them against the real implementation, and compare each observable state with
a simpler reference model. Checking only the settled value misses optimistic
flashes, stale subscribers, and notifications to unrelated fields.

## Automated coverage

| Boundary | Generated operations | Invariants |
| --- | --- | --- |
| [Rust engine](../../../crates/client/cache-core/tests/model_fuzz.rs) | Optimistic property assignments; single and array mutation results; overlapping and coalesced edits; claims; success with canonical server values; rejection; retry; stale replies; remote writes; reorder; restart; directive changes; subscriber teardown and delayed polling | Every queried and subscriber-visible result matches committed data plus pending edits in order. Rejection removes only the rejected edit. Success links the canonical assignment without an intermediate gap. Stale claims cannot change state. Queue order survives restart. Every delta addresses an existing, changed field. |
| [Turso filesystem](../../../crates/client/cache-turso/tests/model_fuzz.rs) | The same independent oracle, using a real database and reopening its file | Eviction, queue ordering, optimistic rebase, and restart agree with the model through the production storage adapter. |
| [Transaction failures](../../../crates/client/cache-turso/src/storage/test/optimistic_atomicity.rs) | Inject errors at every exposed write checkpoint for enqueue/coalescing, commit, rollback, network refresh, clear, and account switch; retry after reopening | A definite failure changes neither durable state nor visible revision, optimistic values, or subscribers. A later retry succeeds. Account switches replace data and identity together. |
| [Solid live queries](../src/lib/graphql-cache/exchange/live-query.fuzz.test.ts) | Field patches; full snapshots; list insertion, removal, and reorder; delayed subscribers; disposal | All subscribers converge. Every synchronous reactive observation is coherent. Retained rows preserve object identity. Single-field edits notify only changed fields. Previously published snapshots stay immutable. Disposed observers stop running. |
| [Async query reader](../src/lib/graphql-cache/exchange/document-query-reader.test.ts) | Random reply ordering, hits and misses, older failures, teardown, invalidated generations | Older responses cannot publish over an accepted newer revision, including after a newer miss. Invalidated reads cannot resurrect a view. |
| [Response shape](../src/lib/graphql-cache/exchange/live-query.test.ts) | Generated field aliases, unions with colliding IDs, missing typenames, identity changes, null/object transitions, duplicate and overlapping patches | Retained proxies never change entity identity. Conflicting/overlapping patches reject atomically. Identical fragment duplicates are accepted. |
| [Exchange and Solid adapter](../src/lib/graphql-cache/exchange/normalized-cache-exchange.test.ts) | Lost settlement acknowledgements, expired leases, reset during request/commit/effects, reused transaction IDs, reserved-looking GraphQL aliases | Successful responses retry local settlement without another network call in the same surviving exchange. Old storage generations cannot settle new transactions or continue later effects. All selected fields survive successive UI updates. |
| [Mutation coverage](../src/lib/queries/mutation-coverage.test.ts) | All GraphQL mutation documents and the installed local resolver registry | Every mutation declares optimism or an explicit authoritative/inactive policy; resolver declarations cannot silently drift from registration. |
| [Project adapters](../src/features/projects/projects.test.tsx) and [mentions](../src/lib/queries/agent-session/mentions.test.tsx) | Changing lookup IDs, retained live records, disabling reads, permission denial followed by cache hits, temporary membership, uncached mutation/reconnect refresh | Stable lookups do not disappear as siblings mount. Authoritative relationships and denials override temporary membership. Disabled/denied identities stay hidden. |
| [Rename settlement](../src/features/entity/queries/rename.test.tsx) and [initiative transport](../src/lib/service-clients/service-storage/initiative.test.ts) | Queued partial responses, background rejection, permanent GraphQL permission failures | Legacy projections do not retain failed optimistic names. Queued responses are acknowledgements. Domain error codes survive optimistic settlement. |
| [Creation bridges](../src/features/projects/queries/create-project-task.test.ts) and [project cache writes](../src/features/projects/queries/project-task-cache.test.ts) | Viewer/host/reset changes during REST saves and cache reads; canonical task-ID handoff; full project responses during creation | Old operations cannot publish into a replacement cache. Pending tasks and project chips survive unrelated responses until settlement. |
| [Refresh ordering](../src/lib/queries/trailing-refetch.test.ts) | Concurrent invalidations, failed earlier reads, owner disposal | A change during a pending read gets a trailing read; disposed owners stop requesting work. |

The shared [Rust oracle](../../../crates/client/cache-core/tests/support/optimistic_model.rs)
uses ordinary document lists and pending edits. It does not use
cache normalization, dependency indexes, link recipes, or cache reads to construct
its expected results. It exercises aliases, named fragments, unions, omitted
variable defaults, directives, two argument variants, and small hot caches that
force records out of memory. Subscribers apply the engine's actual deltas to their
own snapshots.

The frontend tests use the browser build of Solid, including real stores and
computations. They check both the immutable query result and the live reactive
objects, since one can be correct while the other is stale.

Keep explicit regression and performance tests alongside generated tests. For
example, the existing 1,000-row tests in `live-query.test.ts` and Rust's
`engine/watch_query/test.rs` check targeted notifications and bounded record
reads. These are structural cost assertions, not timing thresholds that vary by
machine. The generated tests found that replacing a patched list lost retained
row identities; the minimized example now also lives in `live-query.test.ts`.

## Run and reproduce

All suites are ordinary package tests and run through their existing test
discovery. From the repository root, run the core suite with `SQLX_OFFLINE` unset:

```sh
nix develop --command env -u SQLX_OFFLINE cargo test -p cache-core
nix develop --command env -u SQLX_OFFLINE cargo test -p cache-turso
```

From `apps/web`:

```sh
nix develop --command bunx vitest run src/lib/graphql-cache src/lib/urql-solid src/lib/queries/properties
```

By default, Proptest generates 256 sequences and fast-check generates 250. The
core generates up to 80 actions per sequence; Turso generates up to 40. The Solid
model generates up to 80 actions over up to 12 initial rows; reader schedules have
up to 16 concurrent replies. Default seeds vary between runs. For a larger,
reproducible run, use these commands in their respective directories:

```sh
nix develop --command env -u SQLX_OFFLINE PROPTEST_CASES=2048 PROPTEST_RNG_SEED=20261004 cargo test -p cache-core --test model_fuzz
nix develop --command env -u SQLX_OFFLINE PROPTEST_CASES=256 PROPTEST_RNG_SEED=20261004 cargo test -p cache-turso --test model_fuzz
nix develop --command env CACHE_FUZZ_RUNS=2000 CACHE_FUZZ_SEED=20261004 bunx vitest run src/lib/graphql-cache/exchange/live-query.fuzz.test.ts src/lib/graphql-cache/exchange/live-query.test.ts src/lib/graphql-cache/exchange/document-query-reader.test.ts
```

Proptest shrinks failures and persists regression seeds next to the integration
test in `model_fuzz.proptest-regressions`. Retain that file when a failure is
found, and turn the smallest counterexample into a named regression test.
Fast-check reports a seed, shrink path, and counterexample. Replay the same
generator revision with `CACHE_FUZZ_SEED=<reported seed>` and set
`CACHE_FUZZ_RUNS` to the original run count. The Solid model also accepts
`CACHE_FUZZ_PATH=<reported path>` for its minimized case.
Convert its minimized case into a named test too.

## Confidence boundaries

Passing these tests gives evidence for the generated state space, not a proof for
every GraphQL query or every production failure. These tests use supported schema
shapes rather than generating arbitrary GraphQL documents. The oracle now runs
against both in-memory storage and real Turso files. Fault tests cover the
adapter's exposed transaction checkpoints; they do not cut process power at
every possible I/O instruction. An uncertain commit retires the adapter until
recovery rather than promising that the transaction rolled back. The frontend
property test starts at the query-patch boundary rather than crossing the
worker/WASM transport.

Entity reuse requires selected `id` and concrete `__typename`, including aliases.
Without concrete type identity, snapshots conservatively replace entities;
fully identified descendants remain reactive even when their ambiguous ancestor
is replaced, and field patches still target their exact paths. Legal aliases named `constructor`,
`prototype`, or `__proto__` use immutable result replacement because Solid's
reconciliation reserves those names. This preserves correctness but gives up
field-level reconciliation for those response shapes.

A surviving exchange retains a successful server response while retrying failed
local settlement under a fresh lease. It discards that response on a storage
reset and fences late replies from the old storage generation. This is **not
exactly-once network execution**: process loss, another runner taking over, or a
lost network response can still make the outcome unknown. Non-idempotent server
mutations need server-supported idempotency keys or reconciliation before replay.

Before treating the entire query surface as covered, also require:

- Existing schema projection, identity isolation, cursor retention, worker
  lifecycle, and mutation recipe tests to pass.
- Browser checks of optimistic edits and rollback across tabs, with delayed
  mutation and refetch responses; see [task verification](../../../docs/AGENT_GUIDE/tasks.md).
- Storage failure and worker takeover tests against the actual storage adapters.
- Longer rotating-seed runs and permanent regressions for every discovered bug.

Filter membership and ordering still require a supported query plan or explicit
membership recipe. Randomized property assignment tests do not establish that
arbitrary server-side filters can be maintained locally.
