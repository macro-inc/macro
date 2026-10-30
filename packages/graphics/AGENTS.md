# Graphics

## Scope

Portable Canvas scene, commands, rendering and collaboration. Keep `src/core`
independent of Loro, Mirror, DOM, Solid and Macro services. Hosts own rich text,
assets, permissions, durable sync and document lifetime.

## Start here

- `src/core/backend.ts`: editor/backend contract and history ownership.
- `src/loro/schema.ts`: typed Mirror schema over the deployed native scene tree.
- `src/loro/scene-mapping.ts`: graphics projection and coherent coordinate frames.
- `src/loro/README.md`: persisted representation and conflict/undo policies.

## Gotchas

The Loro backend owns one scene Mirror, even when the host owns its LoroDoc.
Keep generic tree operations in `@loro-mirror/core`; keep coordinate conflict
interpretation here. Never replace native IDs on a move or rewrite unchanged
registers. Opening an existing scene performs no conversion writes. Preserve
atomic pose, independent text/style registers and metadata exclusion from undo.
Dispose editors before their backend, and the backend before a host-owned doc.

## Checks

- `bun run --cwd packages/graphics type-check` (includes the core-only boundary).
- `bun run --cwd packages/graphics test`.
- Exercise Canvas browser and worker suites when changing the Loro adapter.
