# Calendar

## Scope

Shared calendar rendering, event editing, preferences, and occurrence presentation.
`../calendar-view/` owns the route/workspace; `../block-calendar/` owns the legacy host.

## Start here

| Entry | Responsibility |
| --- | --- |
| `context/calendar-navigation-context.tsx` | Host-neutral dates, ranges, and navigation. |
| `components/CalendarPagerContext.tsx` | FullCalendar page handles, retained data, and deferred rendering. |
| `../../components/ui/components/SnapPager/SnapPager.tsx` | Native horizontal paging and discrete desktop commands. |
| `components/CalendarViewContext.tsx` | Selection, source visibility, and preferences. |
| `hooks/use-calendar-occurrence-data.ts` | Account/range reads and event projection. |
| `components/composer/parts/ComposerRoot.tsx` | Composer context and shared parts. |
| `primitives/create-calendar-composer.ts` | Form permissions, metadata, and shared When model. |
| `primitives/create-calendar-composer-session.ts` | Mounted draft lifecycle and discard guard. |
| `primitives/create-calendar-panel-state.ts` | Exclusive sidebar card/editor occupancy. |
| `primitives/create-calendar-panel-placement.ts` | Floating/pinned geometry and drag telemetry. |
| `primitives/create-agenda-paging.ts` | Bounded Agenda windows and scroll anchors. |
| `../calendar-view/views/mobile/month-bars.tsx` | Phone Month rendering and day-sheet focus. |
| `components/composer/create-calendar-event-form-controller.ts` | Draft validation and field updates. |
| `hooks/use-event-editor.ts` | Save and conference-replacement transport. |

## Boundaries

- Keep pure logic in `core/`, reactive behavior in `primitives/`, presentation in `components/`, and host composition in `views/`.
- Reuse `../../lib/queries/calendar/`; never add a parallel event cache.
- Keep Agenda on the navigation contract, never a FullCalendar view.
- Use semantic colors, shared type scales, and standard control props; group related content with container gap/padding.
- Share date/time arithmetic and parsing through `../../components/date-time-range/`; pass clock preferences from hosts.
- Keep one composer model/context; leave replaced desktop and agent compositions independent.
- Retain main's unwired reference forms and Pager; remove superseded branch-only implementations.
- Let callers own `TraceFlow`; start interactions at actions and keep asynchronous work attached to its flow.

## Editing and placement

- Keep the same editor mounted while pinning or floating; guard dirty replacement and all dismissal paths.
- Use the shared sidebar target and drag primitive for cards and composers; gate pinning on measured host width without losing the requested pin.
- Preserve explicit metadata through both save and conference replacement; do not rewrite untouched values.
- Keep single-occurrence visibility unavailable because read APIs omit that override.
- Compose phone menus as inline choices or pages inside the same sheet, never stacked drawers.
- Stage People and custom recurrence changes until Done; discard staged changes on Back or permission loss.
- Keep unsaved Day-grid resizing bound to the mounted draft, not persisted-event mutations.

## Checks

From `apps/web`, run affected tests and `bun run check`.
Run `bun run test src/features/calendar src/features/calendar-view src/components/date-time-range` for integrated changes.
From the repository root, run `just check`.
Use [the Calendar walkthrough](../../../../../docs/agent-guide/calendar.md) for signed-in desktop/phone verification.
Gallery examples supplement real-route checks; they do not replace them.

## Gotchas

- Preserve event ID plus occurrence key; a series ID alone is not an occurrence.
- Provider event ends are exclusive; all-day form end dates are inclusive.
- Imported zero-duration events are points, not editable ranges.
- Preserve authorization, protected guests, and read-only team projections through recomposition.
- Distinguish initial account/range loading from background refresh; never show another range's retained events.
- Keep mini-calendar reads bounded to its displayed grid and use exclusive event ends.
- Preserve unknown availability as unknown; never infer free status from unsupported or failed reads.
- Reject nonexistent DST times and preserve RRULE fields when changing time zone.
- Mount scoped popover content only while open so focus attaches and restores correctly.
- Keep the agent tool's single proposed time and unsupported visibility read-only; do not invent alternatives.
