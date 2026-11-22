# Calendar

## What it is

Reusable calendar rendering, event editing, preferences, and occurrence presentation.
The route and workspace composition live in `../calendar-view/`; the legacy block
host lives in `../block-calendar/`.

## Start here

- `context/calendar-navigation-context.tsx`: host-neutral dates, visible ranges,
  period selection, and navigation commands. `components/CalendarPagerContext.tsx`
  retains five FullCalendar handles, a native `SnapPager` ring, and occurrence data;
  `../calendar-view/views/grid-navigation/CalendarGridNavigation.tsx` adapts it at the host boundary.
- `components/CalendarViewContext.tsx`: selection, source visibility, and display preferences.
- `context/event-rsvp-context.ts` and `components/event-rsvp/`: shared response state
  and composable choices, feedback, and recurring-scope controls for event rows and cards.
- `../calendar-view/views/needs-reply/`: calendar-only invitation list over the existing
  progressive occurrence source; keep the shared call sidebar unchanged.
- `components/SourceControls.tsx`: connected accounts start expanded; disclosure
  changes layout only, while account and calendar checkboxes control visibility.
- `hooks/use-calendar-occurrence-data.ts`: range reads and event projection.
- `components/composer/create-calendar-event-form-controller.ts` and
  `hooks/use-event-editor.ts`: draft validation, permissions, and submission.
- `components/composer/root/` and `context/calendar-composer-context.ts`: new composer
  Root/parts over `primitives/create-calendar-composer.ts`; preserved behavior has
  temporary old/new conformance coverage. `views/composer/StandaloneComposer.tsx`
  owns the readiness boundary; `CalendarComposerEditor.tsx` selects desktop/phone
  composition around one model from `views/composer/create-standalone-composer-setup.ts`.
  `../calendar-view/views/composer/` owns floating/pinned placement and navigation
  dismissal through `primitives/create-calendar-composer-session.ts`. Cards and
  composers share `create-calendar-panel-placement.ts`, the left-sidebar target,
  and `create-composer-header-drag.ts`. `create-calendar-panel-state.ts` owns
  exclusive sidebar occupancy and guarded card/editor handoff. Pinned occurrence changes use
  `create-pinned-composer-selection.ts` and `replacePinned`; resolve selection again after discard approval.
  During drag, hide sidebar contents behind its dashed target. Keep the pointer's
  two-axis position after release and cap the floating body below fixed chrome.
  Keep replaced form and split components unwired for reference.
- `primitives/create-composer-metadata.ts` owns explicit visibility/time-zone edits;
  the optional metadata argument to `useEventEditor.save` preserves legacy callers.
  Initialize the zone to the zone represented by the form's wall-clock fields.
  Single-occurrence visibility stays unavailable because neither read API returns its override.
- `primitives/default-composer-values.ts` seeds only unsupplied new drafts at the
  next half hour for thirty minutes; preserve supplied ranges and edit values.
- `primitives/create-day-draft-range.ts` binds phone Day-grid instants to the
  mounted composer's wall-clock range and selected time zone; grid resizing
  changes only the controller's start/end fields. `dispatch-day-draft-time-change.ts`
  routes unsaved resizes away from persisted-event mutations. The popover registry
  supplies the binding through context without changing the legacy split adapter.
- `types.ts`: occurrence identity, source metadata, viewer capabilities, and the
  grid-only `CalendarGridPeriodView` versus route-level `CalendarPeriodView`.

## Boundaries

- Build redesigned calendar-owned UI as new Root-and-parts components; port preserved
  behavior into primitives using old/new conformance tests, keep those temporary
  tests out of commits, and retain replaced components unwired for reference.
- Place standalone composer instances under a caller-owned `TraceFlow`; flags and
  delayed suggestions register loading phases without owning placement or navigation.
- Keep desktop creation menus non-modal during their handoff to the composer;
  pinning changes its virtual anchor and dock space, never its mounted editor.
- Keep new behavior in `primitives/`, pure domain code in `core/`, transport
  adapters in `queries/`, and host composition in `views/`.
- Keep presentation components independent of production services; use the
  [frontend feature architecture](../../../../../docs/architecture/frontend-features.md).
- Share date/time arithmetic and typed-clock parsing through `../../components/date-time-range/`.
  Active composer When layouts are `DesktopWhen` (D1) and `PhoneWhen` (P4), under
  `ComposerWhenRoot`. The shared `create-composer-when.ts` owns picker exclusion,
  selected-end intent, range validation, and day-specific end options; detail
  resets invalidate intent through the controller's `detailsRevision`.
  `WhenMonth` keeps six-week Corvu keyboard semantics at two sizes. Phone dates
  always include the end while timed. All-day phone ranges use one row and hide
  a same-day end. Phone date/time pickers expand inline. Phone time uses shared
  `components/date-time-range/time-wheel/TimeWheel.tsx` over the same native wheel
  columns as the month/year sheet; keep desktop clock inputs unchanged. Preserve
  off-step minutes until changed, keep 24 internal hour values so noon/midnight
  carry AM/PM while the twelve-hour labels repeat, apply five-minute steps, always move the
  end with a start-wheel change, and clamp end-wheel changes at start plus five
  minutes. Escape returns focus to the matching date or time trigger. Other phone controls use
  `PhoneComposerMenuRoot`: fixed lists up to five non-wrapping choices expand inline;
  searchable, longer, and multi-step choices use pages inside the same sheet.
  Repeat uses a page with Custom one level deeper, never a second drawer.
  Old `ComposerWhen` and `MobileComposerWhen` stay unwired for reference.
  `PhoneSheetComposer` owns the sheet's footer, header, and sole scroll viewport.
  New-menu sheets use 92% height; timed phone Day slot taps request a low 42%
  non-modal sheet with no scrim and a separate unsaved FullCalendar draft.
  Its native start/end resize handles bind only to the mounted composer's range;
  only that sheet ignores outside dismissal during a draft interaction. The
  sheet requests an opaque surface through the same owned drawer-height
  registration. Optional fields keep their initial slot, stay open on blur, and
  collapse only through the empty-field remove action. Add-field visibility and
  scroll-driven compact-title progress live in composer primitives. Keep the compact title absolutely overlaid in the
  zero-height header outlet; it never changes the scroll body's geometry.
  Guest selection stages changes on a People page and applies only on Done;
  Back or permission loss discards the page draft. Keep source-backed suggestions.
- `primitives/create-agent-composer.ts` keeps one validated review decision; the
  agent host selects `AgentComposer` or `MobileAgentComposer` over that model.
  `create-calendar-composer-setup.ts` constructs the shared controller/model;
  normal and agent hosts supply transport and lifecycle callbacks. Anchored and
  pinned views share one mounted `DesktopComposer` field tree and own their chrome.
  The legacy `EventComposerSplit` route delegates to `StandaloneComposer`.
  Both layouts use creation-only Event/Out of office choices below the title,
  with the agent mark in the title icon column. Creation choices use 24px faces
  with 12px text on desktop and 28px faces with 13px text inside 44px touch
  targets; leave 6px below the title. Pass explicit time-zone metadata through
  the tool adapter and keep unsupported visibility read-only; the tool accepts one time, not alternatives.
  Feed the same validated time and recurrence snapshot to the preview and submission.
- Visibility offers Calendar default/Public/Private, displays synced confidential
  as Private, and preserves the original value until an explicit change.
- Stage custom recurrence in the shared Dialog on desktop and the Custom page
  on phones; Back/Cancel leaves the current rule intact. Keep newly revealed
  options after existing fields. Phone time zone belongs above Repeat in When;
  reminder/visibility rows follow Calendar in the Call/Calendar group.
- Use `inset-ring-*` for inset focus rings; `ring-inset` also selects the theme's inset color and overrides accent.
- Pass the calendar clock preference into shared date/time controls from their
  host; generic fields must not import calendar preferences.
- Browse calendar foundations at `/app/component/ui?ui=date-tile`,
  `?ui=calendar-swatch`, `?ui=busy-indicator`, `?ui=value-pill`, and `?ui=time-input`; sheet parts use
  `?ui=mobile-sheet-parts` and `?ui=wheel-picker`.
- The desktop month picker composes `components/month-picker/` parts and keeps
  its temporary year/date state in `primitives/create-month-picker.ts`; navigation
  uses the workspace navigation context. Keep grid paging and scroll timing in
  `CalendarPagerContext.tsx`; `SnapPager` owns native horizontal scrolling on phone
  and desktop. Re-date only recycled pages after settling, never gate swipes on the
  render queue, share active vertical scroll with all buffers, and lock horizontal
  paging during FullCalendar drag/resize. Explicit date selections prepare only the
  hidden destination before sliding, then update the date anchor at settlement.
  Accumulate rapid period commands in SnapPager and prepare only the quiet final
  range; headers follow the requested date immediately. Calendar history captures
  the visible date plus grid scroll or Agenda window/day offset; restore that
  entry state before opening-hour defaults, including a saved midnight position.
  Phone `/calendar/search` uses the shared search control without a grid navigation
  provider; its header owns the input mount. Keep desktop search in the popover.
- Compose the desktop date-navigation/tabs/search row above the 22px month title
  and creation actions; the touch header uses separate shell menu, month,
  Today, and circular Search islands. Keep its loading skeleton aligned. The desktop month
  picker uses 304px width and 64×40px choices.
- Wrap the desktop content card in `Layer offset={1}` and use `bg-surface`, with
  12px gaps and clipped rounded corners; keep Agenda headers opaque at the same
  depth. Keep navigation outside and the opening hour label inside the viewport.
- Mount `Popover.Content` with its open state when using `ScopedPortal`, so the
  focus scope attaches to real content and restores focus when the picker closes.
- Keep the phone Month switch in `../calendar-view/calendar-month.tsx`; render Bars through `views/mobile/month-bars.tsx` over a Sunday-start, five/six-week range, shared span lanes and overflow counts. Keep the old PhoneMonth unwired. Open the picked day's sheet without leaving Month; only its title changes to Day. Let explicit day taps and sheet dismissal retire pending focus requests. Give each day an accessible description of all its event titles, including overflow. Preserve the bounded source and visible-row focus path.
  The phone month island uses `../calendar-view/views/mobile/month-drawer.tsx` with
  shared month/year wheels over `primitives/create-month-wheel-picker.ts`: months
  loop independently, years span 1970–2100, and settling navigates without
  dismissing. Week selection keeps the first visible week's ordinal; Today
  navigates to today and dismisses the sheet.
- Host phone navigation through the shell's `NavigationSheet`, as Email does;
  `views/mobile/calendar-sidebar.tsx` keeps one fixed Calendar title header above views,
  account calendars, booking links, and a fixed `MobileDrawer.Section` Settings footer.
  Keep all five drawer view rows text-only, with the selected state intact. Keep desktop sidebar sections unchanged.
  `/calendar/settings` is an authenticated native view over existing setting owners;
  give its content `Layer depth={2}` with `bg-surface` cards above `bg-page`. Retain
  its `view-` route id and component registry entry for the split-content bridge and shell metadata.
- Keep phone grid layout tokens in `calendar-phone-grid.css`; hours sit outside
  the timed card, with day headers and all-day lanes above it. The active grid
  supplies a stationary, opaque panel-colored gutter through `create-mobile-grid-axis.ts`;
  synchronize its vertical scroll without fading the hour labels or showing an
  All day gutter label. Reveal only the timed card's shared 32px fade past the opening offset.
  Keep timed-card grid lines below the all-day row and do not shade weekends in any view.
  Keep midnight and the current-time gutter label aligned with the card lines.
  `timeGridThreeDay` advances by three days.
- Desktop and phone all-day rows share the base-lane count and 48px cap from
  `core/all-day-row.ts`; let FullCalendar allocate lanes and expose overflow
  through its native more link. Do not reserve a second empty creation lane.
- Keep Agenda on the navigation context, with five fourteen-day windows clipped
  to supported occurrence bounds; never pass Agenda to a FullCalendar API.
- Keep Agenda rows open-only; RSVP controls belong in event details and Needs Reply, not Agenda rows.
- Keep the visible Agenda day anchored through late data and window rotation;
  resolve its logical date again when query projection replaces or merges rows.
  `create-agenda-paging.ts` owns resize observation, and each explicit date request
  starts a fresh list even when its calendar day is unchanged. Preserve user movement
  during prepend frames and resolve merged headings instead of zero-height markers;
  queue edge input through the frame and stop at supported date bounds. `create-agenda-grouping.ts`
  merges confirmed empty ranges across window boundaries without merging today;
  group-end metadata lets paging anchor requested dates inside collapsed ranges.
- Reuse `../../lib/queries/calendar/` for account-scoped reads, optimistic writes,
  and REST/GraphQL handoff; never add a parallel event cache.

## Checks

From `apps/web`:

- `bun run test src/features/calendar src/features/calendar-view src/components/date-time-range`
- Run affected tests and `just check` for small fixes; run `bun run check` and the
  full audit at the phase checkpoint.
- Batch signed-in frame comparisons per coherent UI piece, not per small tweak;
  include desktop/touch keyboard focus and reduced motion. Follow the
  [calendar walkthrough](../../../../../docs/agent-guide/calendar.md).

From the repository root: `just check`.
- Verify visual changes on the real signed-in Calendar route; gallery and fixture checks supplement, but never replace, that verification.

## Gotchas

- Preserve event ID plus occurrence key; a recurring series ID alone is not a
  rendered occurrence identity.
- Provider event ends are exclusive; shared all-day form values include the end
  day. Keep conversion at the existing form/occurrence boundaries.
- Imported zero-duration timed events are points, not editable time ranges.
- Keep mini-month marker reads bounded to its displayed six-week grid and project
  occurrences by local calendar day with exclusive ends.
- Keep authorization, guest-policy restrictions, and read-only team projections
  intact when recomposing event actions.
- Keep source readiness and account/range changes distinct from background refresh;
  an uncached range must not display another range's retained events.
