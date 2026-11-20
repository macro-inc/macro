# New Home

Desktop Home with Recents and Notifications tabs, behind `enable-new-home` and
`disable-old-home`. It composes `features/home` (Recents) and
`features/notifications-inbox` (Notifications); it owns no data of its own.

## Map

- `core/new-home-mode.ts`: the flag states (`off`, `both`, `new-only`), which
  Home a `/home` split shows, and which rail item a split marks.
- `components/`: the Recents and Notifications tabs, from props.
- Root files are the app wiring: the mode hook (`use-new-home-mode.ts`), tab
  navigation, per-user preferences (last tab, Condensed), the tab bar with its
  number-key and Tab hotkeys, and the two tabs' views. `route-views.tsx` is
  `/new-home`, which opens the last tab.

## Gotchas

- Recents is `/home` on the `recent` Home tab, not a route of its own, so Home's
  preview, calendar and deep-link routes serve it. Every Home navigation
  carries the tab; old Home reads a `recent` link as Signal.
- Notifications is `/notifications` with a `NotificationsFrame`; keep the
  inbox's own header and hotkeys for the flag-off path.
- Touch devices resolve to `off`: never add New Home to a mobile view.

## Checks

From `apps/web`, run `bun run test -- src/features/new-home src/features/home
src/features/notifications-inbox src/components/app/sidebar-next`. Walk the
three flag states in `docs/agent-guide/home.md#new-home`.
