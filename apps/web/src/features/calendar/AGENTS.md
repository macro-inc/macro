# Calendar

## What it is

Reusable calendar rendering, event editing, preferences, and occurrence presentation.
The route and workspace composition live in `../calendar-view/`; the legacy block
host lives in `../block-calendar/`.

## Start here

- `components/CalendarViewContext.tsx` and `CalendarPagerContext.tsx`: selection,
  source visibility, display preferences, and period navigation.
- `hooks/use-calendar-occurrence-data.ts`: range reads and event projection.
- `components/composer/create-calendar-event-form-controller.ts` and
  `hooks/use-event-editor.ts`: draft validation, permissions, and submission.
- `types.ts`: occurrence identity, source metadata, and viewer capabilities.

## Boundaries

- Keep new behavior in `primitives/`, pure domain code in `core/`, transport
  adapters in `queries/`, and host composition in `views/`.
- Keep presentation components independent of production services; use the
  [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).
- Extend `../../components/date-time-range/` for shared date/time fields and
  arithmetic instead of creating a calendar-only implementation.
- Pass the calendar clock preference into shared date/time controls from their
  host; generic fields must not import calendar preferences.
- Browse calendar foundations at `/app/component/ui?ui=date-tile`,
  `?ui=calendar-swatch`, `?ui=busy-indicator`, `?ui=value-pill`, and `?ui=time-input`; sheet parts use
  `?ui=mobile-sheet-parts`.
- Reuse `../../lib/queries/calendar/` for account-scoped reads, optimistic writes,
  and REST/GraphQL handoff; never add a parallel event cache.

## Checks

From `apps/web`:

- `bun run test src/features/calendar src/features/calendar-view src/components/date-time-range`
- `bun run check`
- Exercise changed layouts and interactions on desktop and touch, including
  keyboard focus and reduced motion; follow the
  [calendar walkthrough](../../../../../docs/agent-guide/calendar.md).

From the repository root: `just check`.

## Gotchas

- Preserve event ID plus occurrence key; a recurring series ID alone is not a
  rendered occurrence identity.
- Provider event ends are exclusive; shared all-day form values include the end
  day. Keep conversion at the existing form/occurrence boundaries.
- Imported zero-duration timed events are points, not editable time ranges.
- Keep authorization, guest-policy restrictions, and read-only team projections
  intact when recomposing event actions.
- Keep source readiness and account/range changes distinct from background refresh;
  an uncached range must not display another range's retained events.
