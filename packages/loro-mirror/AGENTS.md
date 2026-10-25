# Loro Mirror

`@loro-mirror/core` projects native Loro containers into typed JavaScript state.
`schema/` defines types and validators; `core/mirror.ts` owns transactions and
subscriptions; `core/tree.ts` reads and diffs native ordered trees; `registry.ts`
tracks container schemas. This workspace fork supports Map, List, MovableList,
Text and Tree. Keep it independent of Canvas, DOM and framework code.

Tree nodes project as `{ data, children }`. Their schema supplies a globally
unique application ID per tree. Reparent/reorder surviving IDs through native
moves; never replace their native IDs or data maps. Validate the entire proposal
before writes, including when scalar validation is disabled. One setState call
commits once; one native batch notifies once. Atomic Value fields remain plain
map registers. Dispose Mirror before the document owner frees its LoroDoc.

## Checks

- `bun run --cwd packages/loro-mirror typecheck`
- `bun run --cwd packages/loro-mirror test`
- `bun run --cwd packages/loro-mirror build`
- Exercise dependent graphics and collaboration suites after container changes.
