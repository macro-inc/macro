---
description: "Module layout, layering, and TypeScript conventions."
paths:
  - "apps/web/**"
  - "packages/**"
globs: "apps/web/**,packages/**"
alwaysApply: false
---

# Frontend architecture and TypeScript

Module layout, layering, and TypeScript conventions.

- **FE-16** Keep modules single-purpose: feature-specific logic out of generic
  util files, generic/collaboration logic decoupled from feature specifics,
  styling out of core business logic.
- **FE-17** Reuse existing shared utilities and primitives before hand-rolling
  (`removeNodeAndRestoreSelection`, Kobalte components) — re-implementations
  reintroduce bugs that were already fixed.
- **FE-18** Within a package, use relative imports — don't route through the
  package's own barrel file; it adds indirection and invites circular
  dependencies.
- **FE-19** Trust `match` narrowing — an exhaustive `ts-pattern` match already
  narrows the type inside each closure; a manual `Extract<>` alias is redundant.
- **FE-20** Exhaustive branching uses `match` from `ts-pattern`.
- **FE-21** No `any` — proper types or `unknown` + type guards.
- **FE-31** Never cast a string to `ItemType` — parse it with `stringToItemType`
  from `@service-storage/client`, the one owner of entity-type spellings (email
  threads alone are stored as `email`, `thread`, and `email_thread`). Enforced
  by ast-grep `ts-no-item-type-cast` + `tsx-no-item-type-cast`, CI error.
- **FE-33** New features and feature restructures use the [layered feature
  architecture](../../../docs/architecture/frontend-features.md), with
  `features/activity` as the reference. Use `core/` for pure feature types and
  functions, `queries/` for wire adapters and query factories, `primitives/` for
  reactive state/actions without JSX, `components/` for presentation from props,
  and `views/` for use-case composition. `context/` holds feature-owned
  capability contracts and the provider/consumer, without production imports or
  fallback. An app-facing entry point constructs real adapters and supplies the
  provider; missing provider setup fails clearly. Meaningful reactive decisions
  depend on narrow feature sources, not concrete query adapters or raw clients.
  Adapters implement those contracts using existing query/cache infrastructure;
  Solid accessors and ownership remain part of the reactive foundation. Per-host
  behavior belongs in callback props, and flags gate mounting outside the
  capability contract. Primitives and adapters depend on feature-owned
  contracts; views depend on primitives and components, and core stays
  independent. Components may import context display types only. Keep data
  availability in source adapters and presentation decisions in primitives;
  avoid interfaces with no independent behavior to protect. Controllers receive
  only their named capabilities; production environments and presentation wiring
  stay in views. Reuse query/mutation infrastructure rather than adding a
  generic async wrapper. Keep request failures distinct from errors after a
  successful write, and require promises when callers depend on completion. Use
  view-state unions when the use case has distinct states; small helpers can
  return accessors. Test feature behavior through injected capabilities, with
  shared helpers in `tests/`. Use fake sources for primitive unit tests and fake
  clients for adapter tests, retaining integration coverage of both. Activity
  still has combined context/production wiring, raw-client injection, and
  UI/import-side-effect stubs; these are documented migration gaps. The detailed
  document covers layer responsibilities, narrow reference exceptions, adoption,
  and review. Register adopting feature paths in both language variants of every
  feature rule. Enforced by ast-grep `ts-/tsx-feature-core-pure`,
  `ts-/tsx-feature-components-presentational`, `ts-/tsx-feature-data-no-ui`,
  `ts-/tsx-feature-layers-use-context`, warning; currently scoped to activity.
  Separate production composition and source-contract inversion still require
  explicit review; the existing rules do not enforce them.
- **FE-34** Treat the legacy block state system as adapter-boundary code, not
  state management for new or refactored surfaces. Do not add new `useBlock*`,
  `createBlock*`, block-scoped signal/store/memo/resource, or block permission
  dependencies. An existing block adapter may read legacy state once and
  translate it into a feature-owned context or explicit props; descendants and
  reusable components receive identity, permissions, state, and lifecycle owners
  through those contracts and must remain mountable without `<Block>`. Never add
  a `<Block>` wrapper merely to satisfy a missing dependency. If shared code
  needs an owner or other host capability, expose it through the owning surface
  context instead of borrowing `BlockContext`.
- **FE-56** Await, return, or `.catch` every Tauri IPC promise (`invoke`,
  `listen`, `addPluginListener`, `unregister`, and plugin wrappers); never end
  a chain with `void` or a bare `.then(cb)`. Native resources are often already
  gone at teardown, so the call rejects and the dropped promise becomes an
  unhandled rejection. Remove event listeners with `unlistenQuietly`
  (`@macro/tauri/unlisten`): `UnlistenFn` is typed `() => void` but returns the
  IPC promise. Channel `onmessage` handlers must never throw, because Tauri
  then stalls every later message on that channel. Enforced by ast-grep
  `ts-/tsx-tauri-ipc-promise-handled`, CI error; unlisten functions, stored
  callbacks, and plugin wrappers still need review.

## TypeScript

- For exhaustive matching use `match(...).exhaustive()` from `ts-pattern`, never
  a hand-written `switch`.
- **FE-47** Blocks are a legacy integration pattern we live with, not an
  architecture to build on. Keep `definition.ts` to registration and lazy
  loading, and the `<name>-block.tsx` adapter to translating block state once;
  put all behavior in the feature layers so it mounts without a block. Don't
  add block-level abstractions, and prefer moving logic out of a block over
  extending it.
