---
description: "Use the web app's standard libraries and house helpers: ts-pattern, neverthrow, TanStack Query, solid-primitives, Kobalte wrappers, and friends."
paths:
  - "apps/web/**"
  - "packages/**"
globs: "apps/web/**,packages/**"
alwaysApply: false
---

# Web libraries

Reach for these before writing a helper or adding a dependency. `packages/sdk`
throws `MacroApiError` instead of returning `Result`, and the Bun/Worker services
under `services/` throw and validate with zod; elsewhere in `apps/web` and
`packages/` these rules apply.

- **FE-35** Branch on unions and literal sets with ts-pattern:
  `match(x).with(...).exhaustive()`. `.otherwise` only for open domains
  (arbitrary strings, error codes, and any payload from a Tauri plugin, worker,
  or the network: the sender ships separately and `.exhaustive()` throws on a
  shape it doesn't know). When such a payload is typed by a closed union you
  still want checked (a generated service enum, a message union, persisted
  data), use `.exhaustive((unknown) => fallback)` instead: it keeps the
  compile-time check and returns the fallback rather than throwing. Read paths
  fall back to an empty or unknown value; write paths and request handlers fail
  the operation (`err`, a rejected mutation, an `ok: false` reply) instead of
  sending or reporting a default. Bare `.exhaustive()` is for closed,
  client-built values; parse anything else into one first
  (`stringToItemType`, `parseEntityType`). Enforced in wire adapters,
  service clients, transports, workers, and SDK event hydrators by ast-grep
  `ts-exhaustive-boundary-fallback` + `tsx-exhaustive-boundary-fallback`, CI
  error. Never hand-write `switch` on a discriminant; a `switch` over
  `event.key` in a keyboard handler is fine.
- **FE-36** Fallible operations return neverthrow `Result` / `ResultAsync`. New
  feature code types errors as `{ kind:... }` unions matched with ts-pattern;
  transport code keeps `ResultError<Code>[]`. Guard with `if (r.isErr())
  return...`, then use `.value`; chain with `andThen` / `mapErr`. Enter from
  throwing code with `ResultAsync.fromPromise` / `fromThrowable` (or
  `catchToResult` for legacy `ResultError`). Never wrap a `Result`-returning
  call in try/catch; `_unsafeUnwrap` is test-only.
- **FE-37** Cross into TanStack Query with `throwOnErr` (`@core/util/result`) in
  `queryFn` and `mutationFn`. Never `throw` a raw error or `new Error(...)` from
  an `isErr()` branch: `ThrownResultError` carries the codes the client's retry
  and auth policy read.
- **FE-38** Server state is TanStack Query: `queryOptions` factories at module
  scope, called as `useQuery(() => xQueryOptions(id()))`; keys come from the
  module's `keys.ts` built with `createQueryKeys`, never inline arrays;
  optimistic mutations use `onMutate` (cancel, snapshot, patch, return context).
  GraphQL reads go through `src/lib/urql-solid` / `createLiveQuery`.
- **FE-39** Check `@solid-primitives/*` before writing a reactive utility, and
  declare the package you import in `package.json`. Debounce and throttle
  through `@core/util/debounce` (`debouncedDependent` for a debounced signal);
  no hand-rolled `clearTimeout`/`setTimeout` pairs, no lodash.
- **FE-40** Use the `@ui/components/*` wrapper when one exists (Dialog, Tooltip,
  Select, Tabs, HoverCard,...) instead of importing `@kobalte/core` directly.
  Merge classes with `cn` (`@ui/utils/classname`), never `twMerge` or `clsx`.
- **FE-41** HTTP goes through the service clients (`safeFetch`,
  `fetchWithToken`, `fetchWithAuth`); raw `fetch` only for presigned or blob
  URLs.
- **FE-42** zod (v4) validates at boundaries only: route and search params,
  persisted state, service responses, worker request bodies.
- **FE-43** Ids: `uuid` `v7` for server-persisted entities (`v5` for
  deterministic ones), `crypto.randomUUID()` for ephemeral or optimistic ids,
  `nanoid` only for Lexical and canvas node keys. Never `Math.random()` ids,
  `uuid` `v4`, or `short-uuid`.
- **FE-44** Dates: `date-fns` (and `@date-fns/tz`) for arithmetic and the house
  `@core/util/date` / `@core/util/time` helpers; `Intl.DateTimeFormat` for
  locale display. No dayjs, luxon, moment, or Temporal.
- **FE-45** Virtualized lists use `virtua`, not `@tanstack/solid-virtual`.
  Persisted UI state uses `makePersistedState` (`src/lib/persistence`) with a
  zod schema, not raw `localStorage` calls.
- **FE-46** Reuse the house helpers instead of re-implementing them: `deepEqual`
  (`@core/util/compareUtils`), `structuredClone` for copies, and
  `@tanstack/pacer` (`AsyncBatcher`, `Queuer`) for request coalescing. `effect`
  stays inside `lib/graphql-cache/worker/**` and `lib/queries/soup/backfill.ts`
  and is never mixed with neverthrow in one module. Don't add lodash, immer,
  axios, ky, or another validator.
