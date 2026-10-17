---
description: "State ownership, reactivity, and async error handling."
paths:
  - "apps/web/**"
  - "packages/**"
globs: "apps/web/**,packages/**"
alwaysApply: false
---

# Solid reactivity and async

State ownership, reactivity, and async error handling.

- **FE-08** No ad-hoc global state modules — shared state for a subtree lives in
  a Context scoped to a clear ownership boundary.
- **FE-09** Derive, don't sync — an effect that only copies one signal into
  another similarly-shaped signal should be a derived signal at the appropriate
  level.
- **FE-10** `createEffect` is for external/imperative systems only (DOM APIs,
  third-party libs, navigation events) — never for deriving state; use `on()` to
  make dependencies explicit when an effect is warranted. Prefer wrapping the
  setter over `createEffect(() => { if (signal()) sideEffect() })` when setting
  a value should also clear related UI, blur a control, or scroll.
- **FE-11** Check `solid-primitives` before writing a custom reactive utility.
- **FE-12** `async`/`await`, not `.then()`/`.catch()` chains; fallible calls
  return `Result` (FE-36) rather than being wrapped in `try`/`catch`. Enforced
  by oxlint `promise/prefer-await-to-then` — `bun run lint:oxlint` from the
  repository root.
- **FE-13** Extract multi-step async coordination into named helper functions,
  and make intentionally-unawaited promises explicit with `void` — no bare
  floating promises. Enforced by type-aware oxlint
  `typescript/no-floating-promises` in `just check` and CI, ratcheted against
  `apps/web/floating-promises-baseline.json`; after fixing violations, lower it
  with `bun scripts/check-floating-promises.ts --update` from `apps/web`.
- **FE-14** Keep neverthrow `Result`/`ResultAsync` intact end-to-end — use the
  existing helpers (`ResultAsync`, `throwOnErr` in `queryFn`, `catchToResult`)
  instead of ad hoc `Promise <-> Result` conversions.
- **FE-15** Guard once, at the top — missing/invalid state gets an early return
  at the start of the function or hook, not a repeated check in every branch or
  a silent fall-through.

## Solid patterns

- Avoid createEffect. Legitimate uses: syncing with external/imperative systems
  (DOM APIs, third-party libs). If you're using it to derive state or trigger
  updates, use a derived signal or wrap the setter instead.
- Prefer wrapping the setter over `createEffect(() => { if (signal())
  sideEffect() })`. When setting focus/selection should also clear another stop,
  blur a control, or scroll, put that work in the setter (or a named helper the
  setter calls) so the action is explicit at the call site — not a distant
  effect watching the signal.
- Use createMemo only when you need referential stability or the derivation is
  expensive. Cheap derivations (() => a() + b()) don't need it regardless of
  subscriber count.
- Before rolling your own reactive utility, check solid-primitives first.
- Never read a solid-query `query.data` unguarded from a component body or an
  eager `createMemo`. `data` is a resource read: while the query is pending it
  suspends the caller's nearest `<Suspense>`, which detaches and re-attaches
  that whole subtree — a blank flash, lost scroll position, remounted editors.
  Gate the read on status (`query.isSuccess ? query.data : fallback`, or
  `queryReadyGate` from `src/lib/queries/gate.ts`); an `isLoading` check is not
  enough, because a disabled or paused query is pending without loading and its
  data read still suspends. Every other field is a plain store read and is safe.
  Remember `createMemo` runs immediately, so a guard inside a `<Show>`/`<Match>`
  further down does not save you. This has blanked the calendar grid twice — see
  `focusTarget` in `src/features/block-calendar/CalendarBlockAdapter.tsx` and
  `useSystemSkillsQuery`.
- **FE-52** Read reactive values (feature flags, `isEditable()`, the current
  user) inside a reactive scope, never as a snapshot at mount. A flag that is
  still loading is not "off".
