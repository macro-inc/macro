# Coding rules

Read this before writing code in this repository, then read what applies to
the area you're changing:

| Writing | Also read |
| --- | --- |
| Rust | [Hexagonal architecture skill](.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md), [Rust guide](docs/development/rust.md) |
| SQL, migrations, SQLx | [Database guide](docs/development/database.md) |
| Web frontend | [Web agent guide](apps/web/AGENTS.md), [frontend feature architecture](docs/architecture/frontend-features.md) |
| Infrastructure | [Infrastructure guide](docs/development/infrastructure.md) |
| A new service, entity, block, or other multi-place change | The matching [guide](docs/guides/README.md) |

Path-scoped rules in `.agents/rules/` load automatically when you touch matching
files; the [style guide](docs/development/style-guide.md) indexes them.

## Code

- Simplest correct change. Fewer lines; deleting is good.
- Fix compiler errors at the cause. No casts, `any`, `unwrap`, or allows to silence them.
- No speculative optimization.
- Extend existing features; no parallel paths or fallbacks.
- Generate types from their source of truth; don't hand-write wire types.
- No macros or helpers just to save a few lines.
- Use native APIs and existing libraries. No polyfills, no homemade crypto.
- Keep types and traits small.
- Name things for what they are. No jargon or slang.
- Compatibility only at deployed boundaries (migrations, persisted formats).

## Correctness

- Anything a caller can retry, cancel, or redeliver is safe to repeat: no double
  effects, no stuck state.
- Clear or drain state only after the step that can fail succeeds. Multi-step
  creates and deletes leave no orphans, and projections can't resurrect a
  deleted row.
- When an async result arrives, check it still applies (same account, selection,
  version) before writing it. When racing async sources, flush the loser's
  buffered state before teardown.
- One bad item never fails a batch or stalls a consumer partition.
- A new gate (permission, archived state, caller type, feature flag) applies at
  every entry point and sibling handler. New routes copy their sibling's access
  check.
- When behavior changes, update every doc that mentions it in the same change.

## Tests

- A bug fix adds a regression test only when the test exercises behavior that
  could plausibly break again: domain logic, queries and data, state machines,
  API contracts, or the reproduced bug path. It fails before the fix and
  doesn't assert UI copy or visibility, restate the implementation's mapping,
  or mock so heavily it can't catch the real failure.
- Add no test for small UI changes (copy, labels, showing or hiding elements)
  unless asked.
- Test behavior, not names or derive round-trips.
- Explicit literals, no tiny helpers.
- No `sleep`, `yield_now`, or polling; use real sync primitives.
- No testing plans; run tests and report results.

## Organization

- **CS-24** Keep source files under ~1000 lines; split before a reviewer has to
  ask.
- **CS-26** Reuse before reimplementing. If the logic plausibly exists (service
  clients, permission checks, OAuth utilities, the `agent` crate), find it and
  reuse or extract it instead of writing a second copy.
- **CS-71** Reuse only what was built for the same purpose. Don't repurpose a
  table, column, type, endpoint, or component for an unrelated feature because
  its shape fits; confirm what it's for (its owner, callers, and docs) first,
  and create a new one when the meaning differs.
- **CS-28** Don't extract single-use code into shared crates or packages
  prematurely. Dependencies point from specific to general, never the reverse.
- **CS-29** Group proliferating root files (e.g. Dockerfiles) into a dedicated
  folder.
- **CS-32** New API and Soup models mirror the shape of their existing
  counterpart: omit fields derivable from a nested field, keep lazily loaded
  collections lazy, and include only fields relevant to the new context.
- **CS-33** Interface methods every implementor must consciously decide get no
  default implementation (e.g. schema version). Defaults are for genuine
  defaults, not escape hatches.
- **CS-34** When mapping is the point of a generic abstraction, design it to map
  `T -> U`, not just `T -> T`.
- **CS-35** Sibling endpoints on a resource share one DTO shape; migrate them
  together rather than changing one in isolation.
