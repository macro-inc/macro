# App shell

## Item dragging

`ItemDragAndDrop.tsx` supplies the shared item drag context. Keep lifecycle logic
in `item-drag-sensor.ts`: capture the activated mouse pointer, end on primary
release, and cancel on Escape, blur, lost capture or pointer cancellation.
Cleanup must clear the sensor and overlay even if a drop subscriber throws.

Consume the release click after an activated drag so pointer capture cannot
open the source row; a new pointer press or keyboard click must remain normal.
Keep Alt pressed through drop delivery; reset it on keyup or blur, not before
subscribers decide whether the operation copies or moves.

## Checks

From `apps/web`:

- `bun run test src/components/app src/components/drag-drop`
- `bun run type-check`
