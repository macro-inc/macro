# Drag and drop primitives

## Ownership

`create-reorder.ts` owns the reorder landing, preview clone and pointer origin.
Cancellation clears all three immediately and prevents later drop delivery.
Keep final cleanup in `finally` so a failing host callback cannot retain a preview.
The app item sensor lives in `components/app/item-drag-sensor.ts`; these helpers
also serve independent reorder providers.

## Checks

From `apps/web`:

- `bun run test src/components/drag-drop`
- `bun run type-check`
