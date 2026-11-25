# Calendar

## Scope

Shared calendar rendering, event editing, preferences, and occurrence presentation.
`../calendar-view/` owns the route/workspace; `../block-calendar/` owns the legacy host.

## Start here

| Entry | Responsibility |
| --- | --- |
| `context/calendar-navigation-context.tsx` | Host-neutral dates, ranges, and navigation. |
| `components/CalendarPagerContext.tsx` | Live page/date mapping, FullCalendar slot retargeting, and bounded preloads. |
| `../../components/ui/components/SnapPager/SnapPager.tsx` | Native virtual track, continuous recycling, and period commands. |
| `components/CalendarViewContext.tsx` | Selection, source visibility, and preferences. |
| `core/page-range.ts` | Exact date windows shared by grid rendering and adjacent preloads. |
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
- Keep one composer model/context; share desktop fields and footer between the normal and agent composers while preserving agent review and phone composition.
- Retain main's unwired reference forms and Pager; remove superseded branch-only implementations.
- Let callers own `TraceFlow`; start interactions at actions and keep asynchronous work attached to its flow.

## Editing and placement

- Keep the same editor mounted while pinning or floating; guard dirty replacement and all dismissal paths.
- Use the shared sidebar target and drag primitive for cards and composers; gate pinning on measured host width without losing the requested pin.
- Preserve explicit metadata through both save and conference replacement; do not rewrite untouched values.
- Omit single-occurrence visibility, recurrence, and guest-policy writes without mutating the staged series draft.
- Compose phone menus as inline choices or pages inside the same sheet, never stacked drawers.
- Stage People and custom recurrence changes until Done; discard staged changes on Back or permission loss.
- Keep unsaved Day-grid resizing bound to the mounted draft, not persisted-event mutations.
- Keep standalone composer hotkey scopes attached to their host so app shortcuts still run from text fields.
- Use the shared ToggleSwitch for All day and the same control surfaces for desktop and agent date/time fields.
- Cap desktop/agent descriptions with the shared Scroll area, leaving short content at natural height and phone description composition unchanged.
- Request recurring edit scope from the Save dropdown, including native form submission; preserve the supported `this_event`/`all` save path and single-occurrence restrictions.
- Keep eligible invitation forwarding as a labelled footer-leading action, separate from Save/Cancel and event-detail header icons.
- Keep native momentum on the virtual track; sample the live viewport without writing scrollLeft during movement.
- Finish the previous target and advance immediately on rapid period presses; use native smooth scrolling for a single press.
- Navigate from known locator dates before loading occurrences, refine Agenda to the resolved occurrence day, and keep skeletons/errors inside the destination page.
- Disable wheel snapping during controlled alignment until the virtual destination rows are mounted.
- Reassign seven stable slots during scrolling, keep the header on the viewport centre, and prefetch only three ranges ahead of the pool; never gate assignment on data.
- Reserve the full two-row all-day envelope in phone Week; use 64px hours only in phone three-day view, leaving Day/Week spacing unchanged.
- Keep phone Month pills title-only and its day-sheet date noninteractive; use semantic readable text and full-strength calendar colors for event dots.
- Share one cache startup head start across concurrent ranges; never restart its deadline per reader.

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
