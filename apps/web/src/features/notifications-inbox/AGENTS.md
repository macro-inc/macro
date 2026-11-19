# Notifications inbox

The app entry `notifications-inbox.tsx` supplies the per-user storage and feed
adapters. `core/` owns row/category semantics, `primitives/` owns reactive state,
`components/` renders controls, and `views/` composes the inbox.

## Filters

- Store `selectedCategories`: no selection shows every kind, including future kinds; selected kinds form a union.
- Carry the empty-selection intent in `InboxScope.allKinds`; selecting every known category still sends an explicit type list.
- Keep All/Unread independent of the category selection and its badge count.
- Keep checkbox selection separate from effective visibility: `isSelected` drives filters, while `isShown` limits clear-by-kind actions.
- Convert legacy `hiddenCategories` on read using the existing per-user storage key, and write only the new shape.
- Reset clears selected categories without changing All/Unread; no hidden-all state exists.
- Keep desktop `InboxFilterMenu` and touch `InboxFilterDrawer` on the shared groups and filter primitive.

## Checks

From `apps/web`, run `bun run test -- src/features/notifications-inbox`.
Run `just check` at the repository root and `bun run check` in `apps/web`.
Follow `docs/agent-guide/notifications.md` for signed-in desktop and touch checks:
empty selection, one/two selected kinds, reset, Unread, and legacy storage conversion.
