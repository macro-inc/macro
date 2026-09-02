# Code Review Style Guide

**Check locally.** `just check` is the single gate: format + lint + code rules, scoped
to your changes vs `origin/main`, every finding printed as `file:line [rule-id]` with
the command that fixes it. `just check full` adds tsc + clippy.

**Format.** One rule per line: `<id> [scope] rule (evidence · enforcement · docs)`.
The id prefix is the domain:

- `CS-##` — Rust backend (`crates/`, `services/`, `tooling/`)
- `FE-##` — frontend and shared TypeScript (`apps/web`, `packages/`)

IDs are stable — cite them in review comments ("see CS-30", "FE-12"), never renumber or
reuse them; deletions leave gaps and new rules append with the next free number. Scope
tags make the list greppable.

CS scopes: `[db]` database & migrations · `[types]` type design · `[cfg]` config, env,
secrets · `[err]` errors & observability · `[arch]` architecture & boundaries · `[api]`
API & handler design · `[sec]` security & permissions · `[rust]` Rust idioms · `[perf]`
performance · `[test]` testing

FE scopes: `[data]` data fetching & queries · `[solid]` Solid reactivity & state ·
`[async]` async & error handling · `[arch]` architecture & module hygiene · `[ts]`
TypeScript · `[ui]` UI / UX conventions

---

## Rust backend (`crates/`, `services/`, `tooling/`)

- **CS-01** `[db]` Generate ids as UUIDv7 in application code — never `gen_random_uuid()`
  (UUIDv4); v7 ids sort by creation time. (#4296)
- **CS-02** `[db]` Make seed/backfill inserts and anything that can race idempotent with
  an `ON CONFLICT` handler. (#4296, #4498)
- **CS-03** `[db]` Prefer natural/composite keys over surrogate ids when the table is
  queried/sorted by those columns anyway, and key REST routes on the natural id.
  (#4296, #4498)
- **CS-04** `[db]` Name user columns `user_id` — not `owner_user_id` or other variants;
  follow existing tables. (#4498)
- **CS-05** `[db]` New tables need a deliberate cascade/cleanup story, not whatever the
  default happens to be. (#4296)
- **CS-06** `[db]` Don't add redundant indexes — a column already covered as the leading
  part of the primary key does not need its own index. (#3961)
- **CS-07** `[db]` Don't store columns that are implicit in context (e.g. a scoping id
  already fixed per durable object / per tenant). (#3961)
- **CS-08** `[db]` Use `sqlx::query!` / `query_as!` (compile-time checked) by default;
  the non-macro form is only for queries that genuinely cannot be statically known.
  (#4156 · enforced: clippy `disallowed-methods` · also: CLAUDE.md)
- **CS-09** `[db]` The `.sqlx` cache lives at the workspace root — run `just prepare_db`
  from the repository root; never commit a `.sqlx` directory inside an individual
  crate. (#4577 · also: CLAUDE.md)
- **CS-10** `[types]` Newtype your identifiers and tokens — wrap raw `String`
  ids/tokens/model-ids in a validated newtype that checks shape at construction.
  (#4020, #4077, #4276)
- **CS-11** `[types]` A closed set of string values is an enum, not a `String` — impl
  `Display`/`FromStr` as needed. (#4296, #4410)
- **CS-12** `[types]` Optional means `Option<T>` — don't rely on sentinel values or
  convention to express absence. (#4296)
- **CS-13** `[types]` Model tri-state data (not-loaded / missing / present) as one flat
  enum, not nested `Option`s or ad-hoc flags. (#4527)
- **CS-14** `[cfg]` All env access goes through `macro_env_var` / `macro_config` — never
  `std::env::var`, never hand-rolled wrappers; use `MaybeEnvVar` for optional vars. The
  same goes for AWS config instantiation (`macro_aws_config`) and tracing subscriber
  setup (`macro_entrypoint`): use the shared crates.
  (#4306, #4334, #4380 · enforced: clippy `disallowed-methods` · also: CLAUDE.md)
- **CS-15** `[cfg]` Fail fast: validate config at service instantiation, not deep inside
  request handling — a missing env var should kill startup, not a request. (#4077, #4156)
- **CS-16** `[cfg]` Don't add `.context()` to env-var macro errors — the macro error
  already statically names the missing variable. (#4156)
- **CS-17** `[cfg]` Doppler secret key names must exactly match the env var name
  referenced in code. (#4525)
- **CS-18** `[cfg]` All new environment variables are plain env vars, not
  `LocalOrRemote`/doppler-wrapped; non-secret config goes in Doppler as raw values, not
  AWS Secrets Manager secrets. (#4305, #4525)
- **CS-19** `[err]` Give third-party errors their own variant — don't collapse e.g. a
  `jsonwebtoken` failure into a generic internal error. (#4020)
- **CS-20** `[err]` Depending on a rate-limited external provider requires a fallback
  (fallback model, retry story, or documented degradation). (#4296)
- **CS-21** `[err]` Wire usage metering on every invocation path — MCP-triggered tool
  calls count too, not just the primary path. (#4296)
- **CS-22** `[err]` Tracing: `#[instrument(err)]` only on `Result` functions; log errors
  as structured fields (`tracing::error!(error=?e, "msg")`); prefer `.inspect_err` over
  `if let Err(e)` for logging. (also: CLAUDE.md)
- **CS-23** `[arch]` Do not grow `macro_db_client` — new domain logic gets a new crate;
  the catch-all crates must shrink, not accumulate. (#4380)
- **CS-24** `[arch]` Keep source files under ~1000 lines — split before a reviewer has
  to ask. (#4364)
- **CS-25** `[arch]` `mod.rs` declares submodules; it doesn't host logic — prefer the
  `foo.rs` + `foo/` file-and-directory style for modules with logic. (#4175 · enforced:
  ast-grep `rust-mod-rs-declarations-only`, error)
- **CS-26** `[arch]` Reuse before reimplementing — if the logic plausibly exists
  (service clients, permission checks, oauth utils, the `agent` crate), find it and
  reuse/extract it instead of writing a second copy. (#3692, #4020, #4380, #4485)
- **CS-27** `[arch]` Shared domain tables are only touched by their owning crate — e.g.
  `entity_access` mutations go through `entity_access`/`entity_access_db_utils`, never
  raw SQL elsewhere. (#3769)
- **CS-28** `[arch]` Don't extract single-use code into shared crates prematurely, and
  watch dependency direction: general-purpose crates must not import from specific ones.
  (#4410)
- **CS-29** `[arch]` Group proliferating root files (e.g. Dockerfiles) into a dedicated
  folder. (#4380)
- **CS-30** `[api]` Axum handlers take shared services via `State`, not `Extension`.
  (#4556 · enforced: ast-grep `rust-no-axum-extension-param`, warning · also: CLAUDE.md)
- **CS-31** `[api]` Attach cross-cutting services to the owning domain service, not ad
  hoc at the router/handler layer — e.g. `EntityAccessManagementService` hangs off the
  email/document service itself, the way the documents crate does. (#4572)
- **CS-32** `[api]` New API/soup models mirror the shape of their existing counterpart:
  omit fields derivable from a nested field, keep lazily-loaded collections lazy,
  include only fields relevant to the new context. (#4165)
- **CS-33** `[api]` Trait methods every implementor must consciously declare get no
  default impl (e.g. schema version) — defaults are for genuine defaults, not escape
  hatches. (#4276)
- **CS-34** `[api]` Design generic abstractions to map `T -> U`, not just `T -> T`, when
  mapping is the point of the abstraction. (#4396)
- **CS-35** `[api]` Keep sibling endpoints on a resource using the same DTO shape;
  migrate them together rather than changing one in isolation. (#4386)
- **CS-36** `[sec]` Permission grants are stateless HTTP endpoints, not channel
  messages — in-memory channel flows don't survive reconnects. (#4201, #4296)
- **CS-37** `[sec]` Mint narrowly-scoped tokens instead of forwarding the user's full
  JWT downstream — least privilege by construction. (#4296)
- **CS-38** `[sec]` Tool responses must be valid members of the message chain — include
  `tool_call_id` and required chain metadata. (#4296)
- **CS-39** `[sec]` Pin third-party GitHub Actions to a commit SHA, not a movable tag.
  (#4276)
- **CS-40** `[rust]` Repeated literals become named consts. (#4020)
- **CS-41** `[rust]` Don't use `#[allow(...)]` — use `#[expect(..., reason = "...")]`
  on the narrowest item it applies to; `allow` silently rots when the lint stops firing,
  `expect` warns. (#4396, #4647)
- **CS-42** `[rust]` Don't re-state trait bounds already implied by a supertrait. (#4276)
- **CS-43** `[rust]` Use the smallest sufficient integer type — a version counter that
  can't plausibly pass 255 is a `u8`. (#4396)
- **CS-44** `[rust]` Large inline strings belong in files — use `include_str!`. (#4156)
- **CS-45** `[rust]` CLI binaries use `clap`, not hand-rolled arg parsing. (#3678)
- **CS-46** `[rust]` Use `rootcause` for error handling in new code — it's preferred
  over `anyhow` these days. In code that's still on anyhow, prefer `bail!` for early
  error returns. (also: CLAUDE.md)
- **CS-47** `[perf]` Keep latency-critical services thin: push bytes directly instead of
  round-tripping through presigned URLs or extra services; dispatch non-blocking
  background work with `wait_until`. (#3781)
- **CS-48** `[perf]` Don't do per-message work on hot websocket paths — accumulate and
  flush on a timer/alarm. (#3961)
- **CS-49** `[test]` Tests live in a sibling `test.rs`, not inline `#[cfg(test)]` blocks
  in the implementation file. (#4647 · also: CLAUDE.md)
- **CS-50** `[test]` Update tests and run `just prepare_db` with any db-crate change.
  (also: CLAUDE.md)
- **CS-51** `[arch]` Domain modules reference no infrastructure or transport: no AWS
  SDKs, redis, reqwest, opensearch, kafka, axum, or http types under `src/domain/**` —
  wrap clients in outbound adapters behind ports; response mapping lives in inbound.
  (enforced: ast-grep `rust-no-infra-in-domain` warning,
  `rust-no-transport-in-domain` error · also: cloud-storage-hexagonal-architecture
  skill)
- **CS-52** `[arch]` Dependencies point inward: `src/domain/**` never imports
  `crate::inbound`/`crate::outbound`, and `src/outbound/**` never imports
  `crate::inbound` — define a port in domain and implement it in the adapter.
  (enforced: ast-grep `rust-domain-no-adapter-imports` warning,
  `rust-outbound-no-inbound-imports` error)
- **CS-53** `[arch]` Inbound adapters run no database queries — handlers, tools, and
  listeners call a domain service backed by an outbound repository, never sqlx
  directly. (enforced: ast-grep `rust-no-sqlx-in-inbound`, warning)

## Frontend and shared TypeScript (`apps/web`, `packages/`)

- **FE-01** `[data]` Never call a service client outside the `queries` package — UI code
  calling an endpoint directly is usually re-fetching data an existing query already
  caches. (#3750, #3961 · enforced: ast-grep `ts-no-service-client-outside-queries` +
  `tsx-no-service-client-outside-queries`, warning · also: AGENTS.md)
- **FE-02** `[data]` Every query module has a `keys.ts` structured like the existing
  ones. (#3710)
- **FE-03** `[data]` Conditional fetching uses a debounced signal passed to TanStack
  Query's `enabled`, not a custom resource. (#3961)
- **FE-04** `[data]` Pre-populating data means exposing a cache-seeding method on the
  query, not an ad hoc manual cache. (#4020)
- **FE-05** `[data]` Data-dependent UI that must not suspend uses `queryReadyGate`.
  (#4077)
- **FE-06** `[data]` Extend `QUERY_FILTERS_BASE` instead of re-deriving filter
  exclusions per query, and prefer explicit include lists — exclude lists silently break
  when a new entity type is added. (#3947, #4260)
- **FE-07** `[data]` Don't hardcode backend-owned config in the frontend (e.g. system
  bot config) — fetch it dynamically or generate types from the backend source of
  truth. (#3692)
- **FE-08** `[solid]` No ad-hoc global state modules — shared state for a subtree lives
  in a Context scoped to a clear ownership boundary. (#3750 · also: AGENTS.md)
- **FE-09** `[solid]` Derive, don't sync — an effect that only copies one signal into
  another similarly-shaped signal should be a derived signal at the appropriate level.
  (#3898)
- **FE-10** `[solid]` `createEffect` is for external/imperative systems only (DOM APIs,
  third-party libs, navigation events) — never for deriving state; use `on()` to make
  dependencies explicit when an effect is warranted. Prefer wrapping the setter over
  `createEffect(() => { if (signal()) sideEffect() })` when setting a value should also
  clear related UI, blur a control, or scroll. (#3750, #3898, #6038 · also: AGENTS.md)
- **FE-11** `[solid]` Check `solid-primitives` before writing a custom reactive utility.
  (also: AGENTS.md)
- **FE-12** `[async]` `async`/`await` with `try`/`catch`, not `.then()`/`.catch()`
  chains. (#3716, #3781 · enforced: oxlint `promise/prefer-await-to-then` —
  `bun run lint:oxlint` from the repository root)
- **FE-13** `[async]` Extract multi-step async coordination into named helper functions,
  and make intentionally-unawaited promises explicit — no bare floating promises.
  (#3781)
- **FE-14** `[async]` Keep neverthrow `Result`/`ResultAsync` intact end-to-end — use the
  existing helpers (`ResultAsync`, `throwOnError` in `queryOptions`, `catchToResult`)
  instead of ad hoc `Promise <-> Result` conversions. (#3781, #4373)
- **FE-15** `[async]` Guard once, at the top — missing/invalid state gets an early
  return at the start of the function or hook, not a repeated check in every branch or
  a silent fall-through. (#3750, #4057)
- **FE-16** `[arch]` Keep modules single-purpose: feature-specific logic out of generic
  util files, generic/collaboration logic decoupled from feature specifics, styling out
  of core business logic. (#3750, #3781, #3947)
- **FE-17** `[arch]` Reuse existing shared utilities and primitives before hand-rolling
  (`removeNodeAndRestoreSelection`, Kobalte components) — re-implementations
  reintroduce bugs that were already fixed. (#4281, #4321 · also: AGENTS.md)
- **FE-18** `[arch]` Within a package, use relative imports — don't route through the
  package's own barrel file; it adds indirection and invites circular dependencies.
  (#3692)
- **FE-19** `[ts]` Trust `match` narrowing — an exhaustive `ts-pattern` match already
  narrows the type inside each closure; a manual `Extract<>` alias is redundant. (#4201)
- **FE-20** `[ts]` Exhaustive branching uses `match` from `ts-pattern`. (also: AGENTS.md)
- **FE-21** `[ts]` No `any` — proper types or `unknown` + type guards. (also: AGENTS.md)
- **FE-22** `[ui]` Pending or permission-gated actions render as a dimmed version of the
  real UI with inline accept/reject controls — not a generic placeholder icon. (#4201)
- **FE-23** `[ui]` Disclosure carets rotate 180° to point down when expanded, matching
  Discussion, SplitFileMenu, CollapsibleMessage, etc. (#4582)
- **FE-24** `[ui]` Truncated/collapsed controls get a tooltip (matching the app's
  tooltip pattern) so the lost label stays discoverable. (#4492)
- **FE-25** `[ui]` Semantic color tokens, not raw Tailwind palette classes — the default
  palette is disabled via `--color-*: initial` in `apps/web/src/index.css`, so
  classes like `text-red-500` silently render nothing. (enforced: ast-grep
  `tsx-no-raw-tailwind-palette`, CI error · also: AGENTS.md)
- **FE-26** `[ui]` Prefer composition over configurability; keep reusable components
  small and free of queries/complex state. (also: AGENTS.md)
- **FE-27** `[ui]` Don't add `cursor-pointer` to clickable elements. (enforced: ast-grep
  `tsx-no-cursor-pointer`, warning · also: AGENTS.md)
- **FE-28** `[ui]` Dialogs rely on Kobalte's default autofocus: make the intended
  target the first tabbable element and preserve focus ownership for restoration.
  Override `onOpenAutoFocus` only for a proven lifecycle requirement, and verify
  `document.activeElement` after both opening and reopening in the live app.
- **FE-29** `[data]` Every new query call site (`useQuery`/`useInfiniteQuery` or a hook
  from `src/lib/queries/**`) needs a deliberate `Suspense` boundary: reading
  `query.data` suspends to the *nearest ancestor* boundary. When reviewing, walk up
  the component tree from the call site and determine which boundary would catch it.
  If none exists below the app root, or the nearest one is far outside the component's
  own UI scope (e.g. the route-level boundary in `apps/web/src/routes/Root.tsx`, whose
  fallback blanks unrelated UI), flag it and ask which boundary is intended.
- **FE-30** `[ui]` Never hoist Tailwind class strings into named constants
  (`const DAY_CELL_CLASS = '...'`) — shared markup+styling is a component; a class
  string can't carry structure, props, or behavior. Extract a component, or inline the
  literal at its single use; styling variants are component props, not exported
  strings. (enforced: ast-grep `tsx-no-class-string-consts`, warning)
- **FE-31** `[ts]` Never cast a string to `ItemType` — parse it with `stringToItemType`
  from `@service-storage/client`, the one owner of entity-type spellings (email
  threads alone are stored as `email`, `thread`, and `email_thread`). (#6043 ·
  enforced: ast-grep `ts-no-item-type-cast` + `tsx-no-item-type-cast`, CI error)
- **FE-32** `[ui]` Prefer styling in the component (Tailwind on the markup). Reserve
  `@utility` in `apps/web/src/index.css` for styles widely shared across many
  components — not one-off or two-callsite layouts. (#6038 · also: apps/web/AGENTS.md)
