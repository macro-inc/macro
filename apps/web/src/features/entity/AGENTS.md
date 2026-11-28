# Shared entity rows

## Drag payloads

`utils/draggable.ts` creates tagged `EntityDragData`; `types/drag.ts` validates
that boundary for drop targets. Keep newly draggable entity types in its accepted
list. Native task projects use `initiative`; Drive folders use `project`.

AI composers use `lib/core/component/AI/primitives/create-composer-item-drop.ts`
to convert these payloads into mention context. Keep source selection intact
when adding context; movement targets own any selection clearing.

## Folder writes

Use `moveEntity` or the bounded `moveEntities` and `duplicateEntities` requests
for folder actions. Their effects update maintained Soup lists. Keep direct
database and form moves in their own batch so other moves can enter the durable
queue. Copy waits for the server to assign an ID.

## Checks

From `apps/web`:

- `bun run test src/features/entity src/lib/core/component/AI/primitives`
- `bun run type-check`
