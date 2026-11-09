# JavaScript node state

## Scope

Keep StateConfig, state records, serialization and public state algorithms here.
`runtime.ts` defines typed injection only; the core runtime owner supplies actual
instance/capture storage, writable and clone authorization, read frames and rollback.
Do not implement a substitute backing store or JSON model state in this directory.

`config.ts` owns a typed WeakMap for each config and closed operations for
heterogeneous iteration. Recover V only through that config's typed store.
`record.ts` provides the non-generic StateRecord implementing the actual generic
NodeState contract; `shared.ts` supplies registered-class configuration data.
`helpers.ts` delegates capture and write authorization through StateRuntime.

## Boundaries

- Preserve raw captured/direct state reads outside active editor scopes.
- Preserve opaque JavaScript identities, lazy parsing, copy-on-write and reset-on-copy rules.
- Keep the canonical public AnyStateConfig parameters on the actual config class; do not recover typed values from erased metadata maps.
- Expose knownState as a live readable Map and reject its unsupported set/delete/clear mutation; public writes use $setState.
- Use only the central applyValueOrUpdater and nodeStateToJSON assertions for the two approved upstream state type gaps.
- Require real static-config factory preparation before exposing createSharedNodeState; do not omit its side effects or install clone placeholders.

## Checks

Run package strict TypeScript/hook checks and state tests, then scoped `just check`.
Keep pure record/config tests and cold evaluation separate from hosted state,
clone, history and rollback acceptance. Do not bind a fabricated StateRuntime in tests.
Run the actual public helper and capture tests after the real runtime binding lands.
