# Shared entity rows

## Drag payloads

`utils/draggable.ts` creates tagged `EntityDragData`; `types/drag.ts` validates
that boundary for drop targets. Keep newly draggable entity types in its accepted
list. Native task projects use `initiative`; Drive folders use `project`.

AI composers use `lib/core/component/AI/primitives/create-composer-item-drop.ts`
to convert these payloads into mention context. Keep source selection intact
when adding context; movement targets own any selection clearing.

## Checks

From `apps/web`:

- `bun run test src/features/entity src/lib/core/component/AI/primitives`
- `bun run type-check`
