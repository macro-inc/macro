# Calendar Composability and Refactor Plan

Status: **composability refactor implemented; hover and AI consumers deferred**

Planning baseline: `rahul/feat-calendar-block-and-params` at `7a02db2f09`.

The current calendar feature is approximately 10.8k lines across 50 files. This plan reflects the singleton `calendar/view` block, instance-scoped event targeting, and the current event composer work.

## 1. Goal

Refactor calendar ownership so that:

- `src/features/block-calendar` owns the complete Macro calendar-block experience and explicitly composes its rendered workspace;
- `src/features/calendar` provides independent, reusable calendar domain logic, data adapters, state controllers, and rendered primitives;
- `src/lib/fullcalendar-solid` contains only the reusable Solid-to-FullCalendar integration;
- alternate calendar consumers can select only the capabilities they need without mounting the calendar block, split layout, side panel, setup flow, or event editor;
- existing calendar-block behavior remains unchanged throughout the structural work.

This architecture must support three concrete consumers:

1. the full calendar block;
2. a lightweight hover surface showing the current day's events;
3. an AI chat tool composer that can display and edit create/update-event tool arguments before execution.

The hover and AI surfaces are composition proofs. They should shape the reusable contracts instead of introducing a speculative universal calendar framework.

## 2. Success criteria

1. The current calendar block retains its desktop and mobile behavior.
2. The full workspace composition lives in `block-calendar/components`.
3. Reusable calendar components do not import block, split-layout, analytics, feature-flag, or cognition contexts.
4. Reusable rendered primitives do not start queries or mutations.
5. Query-backed calendar behavior is available through headless feature hooks/adapters.
6. A caller can render a fixed-data calendar grid without calendar-block providers.
7. A caller can render a lightweight current-day agenda without FullCalendar.
8. A caller can render and control an event form without opening a split or directly executing a storage mutation.
9. The block, hover, and AI tool can use different combinations of the same feature capabilities.
10. Lazy loading and calendar CSS behavior remain intact.

## 3. Concrete consumer matrix

| Capability | Calendar block | Current-day hover | AI tool composer |
| --- | --- | --- | --- |
| Occurrence query | Yes | Yes, while open | No |
| FullCalendar grid | Yes | Prefer no; optional if required | No |
| Three-page buffered pager | Yes | No | No |
| Day/week/month views | Yes | Current day | Not applicable |
| Persisted display settings | Yes | Normally no | No |
| Source visibility controls | Yes | Optional future capability | Calendar selection only |
| Event selection/details | Yes | Optional summary/action | Optional read-only result |
| Create/update form | Opened from block | No | Yes |
| Drag/resize mutation | Yes | No | No |
| Split-layout integration | Yes | No | No |
| AI tool-call persistence | No | No | Yes |

The hover's exact visual treatment remains a product choice:

- preferred: a lightweight agenda grouped into all-day and timed events;
- optional: a single-page miniature time grid using the reusable grid surface.

Do not load FullCalendar in the hover unless the miniature grid is explicitly required.

## 4. Current coupling to remove

### `calendar-view.tsx`

It currently combines provider composition, split headers, side panels, hotkeys, responsive workspace layout, local time state, event details, event composer opening, pager rendering, and calendar rendering.

The full composition now starts in `CalendarBlockAdapter.tsx` and delegates rendered workspace pieces to `block-calendar/components`. A pass-through `View.tsx` is intentionally unnecessary.

### `CalendarPage.tsx`

It currently combines:

- occurrence queries and range construction;
- event mapping and source filtering;
- FullCalendar configuration and rendering;
- loading and synchronization presentation;
- event selection and DOM anchor registration;
- drag/resize mutations;
- event composer opening;
- block-target focus consumption;
- pager registration and stale-page refresh.

These responsibilities must be separated into query-free rendering, headless data, interaction adapters, and block composition.

### `CalendarPagerContext.tsx`

It currently owns both reusable pager mechanics and assumptions about the full calendar view context. Extract the mechanics without forcing every calendar consumer to use the buffered pager.

### `CalendarViewContext.tsx`

It currently combines:

- persisted display preferences;
- visible-calendar querying;
- source visibility;
- selected-event state and anchor ownership;
- responsive header state.

These are independent capabilities. The full block can compose all of them, while other consumers should not need the context.

### Event editing

`EventEditorForm.tsx` contains active domain types, transformations, recurrence state, and form helpers alongside an unused legacy rendered form. `EventComposerForm` uses those helpers but owns internally initialized state, making external tool-call synchronization awkward.

The reusable form model and UI need explicit caller-owned state boundaries.

### Event details

The current details overlay combines presentation, mutations, mobile/desktop shells, composer opening, and block-specific focus behavior. Keep a reusable details body and let the block compose its actions and overlays.

## 5. Dependency and ownership rules

1. Dependency direction is `block-calendar -> calendar -> lib/queries and fullcalendar-solid`.
2. AI tool integrations may import calendar form primitives; calendar must not import AI or cognition modules.
3. Hover owners may import calendar agenda/data primitives; calendar must not import their trigger context.
4. Query and mutation hooks may live in `features/calendar`, but reusable rendered primitives receive data and commands explicitly.
5. Split headers, side panels, popover splits, block targeting, analytics, feature gating, and route behavior belong to `block-calendar`.
6. Prefer small controllers, compound components, and slots over a `CalendarView` component with many boolean flags.
7. Context is allowed when scoped to a clearly owned compound component subtree.
8. Do not require one universal `CalendarRoot` for the grid, agenda, and event form; these consumers need different capabilities.
9. Keep single-owner helpers beside their owner. Only genuinely shared pure helpers belong in `utils` or `domain`.
10. Avoid broad barrel files that could alter lazy-loading or chunk boundaries.
11. Keep mechanical movement separate from behavior changes.
12. Do not generalize around hypothetical fourth consumers until at least two current call sites need the abstraction.

## 6. Target architecture

The exact feature folder names may adjust while extracting real boundaries. This is an ownership map, not a requirement to create empty or one-function files.

```text
src/features/block-calendar/
├── CalendarBlockAdapter.tsx
├── definition.ts
├── types.ts
├── calendar-range.ts
├── calendar-target.ts
└── components/
    ├── Workspace.tsx
    ├── Page.tsx
    ├── Header.tsx
    ├── SidePanelSections.tsx
    ├── SetupStatus.tsx
    ├── SelectedEventDetails.tsx
    ├── EventRsvpSection.tsx
    └── EventComposerSplit.tsx

src/features/calendar/
├── calendar.css
├── data/
│   ├── use-calendar-occurrence-data.ts
│   └── use-calendar-sources.ts
├── domain/
│   ├── calendar-date.ts
│   ├── calendar-types.ts
│   ├── calendar-supported-range.ts
│   └── time-format.ts
├── grid/
│   ├── CalendarGrid.tsx
│   ├── CalendarEventContent.tsx
│   ├── CalendarRangeStatus.tsx
│   ├── calendar-event-mapper.ts
│   └── fullcalendar-dom.ts
├── agenda/
│   ├── CalendarAgenda.tsx
│   ├── CalendarEventSummary.tsx
│   └── calendar-agenda-model.ts
├── pager/
│   ├── CalendarPagerContext.tsx
│   ├── CalendarPages.tsx
│   ├── CalendarPageHost.tsx
│   └── calendar-pager-controller.ts
├── controls/
│   ├── CalendarMonthPicker.tsx
│   ├── CalendarPeriodSelector.tsx
│   ├── CalendarSettingsControls.tsx
│   └── CalendarSourceControls.tsx
├── events/
│   ├── composer/
│   │   ├── CalendarEventForm.tsx
│   │   ├── CalendarEventComposerForm.tsx
│   │   ├── create-calendar-event-form-controller.ts
│   │   ├── event-form-model.ts
│   │   ├── EventDateField.tsx
│   │   ├── EventDateTimeField.tsx
│   │   ├── EventTimeInput.tsx
│   │   └── property-pills/
│   ├── details/
│   │   ├── EventDetails.tsx
│   │   ├── EventAttendeeList.tsx
│   │   └── event-details-model.ts
│   ├── recurrence/
│   ├── calendar-occurrence-mapper.ts
│   ├── event-interaction.ts
│   ├── event-reminders.ts
│   └── types.ts
└── hooks/
    ├── use-calendar-time-grid-hover-indicator.ts
    └── use-calendar-ui-flag.ts

src/lib/fullcalendar-solid/
├── FullCalendar.tsx
├── FullCalendar.test.tsx
└── index.ts
```

`CalendarBlockAdapter.tsx` remains at the block feature root as the public lifecycle/navigation adapter. Components below it use concise names because their path already establishes block ownership.

Do not add a `block-calendar/components/index.ts`; the adapter should directly compose the feature providers and import `./components/Workspace`.

## 7. Composable contracts

Names below are provisional. Validate them against the first two consumers before treating them as public APIs.

### 7.1 Event draft model

Introduce one canonical editable representation:

```ts
interface CalendarEventDraft {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  recurrenceLines: string[];
  calendarId?: string;
  guestEmails: string[];
  location: string;
  description: string;
}
```

Provide pure operations for:

- default draft creation;
- calendar selection to draft;
- existing event to draft;
- validation;
- event-time construction;
- all-day inclusive/exclusive conversion;
- recurrence normalization;
- guest normalization;
- meaningful dirty comparison.

Tool-schema conversion belongs in the AI tool integration rather than this model.

### 7.2 Event form controller and fields

Extract caller-owned state from `EventComposerForm`:

```ts
const form = createCalendarEventFormController({
  initialValue,
  onChange,
});
```

The controller should expose operations equivalent to:

- `value()`;
- field updates;
- `replaceFromExternal(next)`;
- `validate()`;
- `snapshot()`;
- `isDirty()`.

Use a scoped compound-component API for field composition:

```tsx
<CalendarEventForm.Root controller={form}>
  <CalendarEventForm.Title />
  <CalendarEventForm.DateTime />
  <CalendarEventForm.Properties />
</CalendarEventForm.Root>
```

Also provide a default `CalendarEventComposerForm` composition so the block and AI card do not need to duplicate layout immediately.

The controller and fields must not own queries, mutations, split closing, or tool execution.

### 7.3 Occurrence data

Extract a headless query-backed adapter that returns normalized state:

- exact occurrence range;
- mapped and source-filtered events;
- event lookup by render ID;
- loading, syncing, error, and unsupported-range state;
- underlying query only when a use-case explicitly needs it.

The block can enable active-page polling. The hover can enable its query only while open. A fixed-data consumer can skip the adapter entirely.

### 7.4 Lightweight agenda

Provide a query-free agenda/list surface that accepts mapped events and an event-rendering slot. It should support:

- all-day and timed grouping;
- local time formatting;
- empty state;
- optional event activation;
- compact embedded/popover sizing.

Do not make the agenda depend on FullCalendar render arguments. The current `CalendarEventContent` is FullCalendar-specific and is not the agenda row primitive.

### 7.5 FullCalendar grid

Extract a query-free single-grid surface that receives:

- events;
- date/view/display state;
- range-change callbacks;
- optional date-selection callback;
- optional event-selection callback;
- optional event-time-change callback;
- rendered-content slots.

Read-only consumers omit interaction callbacks rather than enabling a large set of boolean flags.

The three-page pager is a separate optional composition around the grid.

### 7.6 Block focus targeting

Keep block request parsing, locator queries, target expiration, and navigation method registration in `block-calendar`.

The reusable calendar layer may define the semantic target consumed by a grid/page, but it must not know about block handles or module-global navigation intent.

### 7.7 AI tool adapter

The future AI tool component should follow the existing email-tool pattern:

```text
AI calendar tool wrapper
  -> maps tool args to CalendarEventDraft
  -> owns debounced tool-call persistence
  -> renders the shared calendar event form
  -> executes the create/update tool after confirmation
```

The AI wrapper owns:

- chat/message/tool-call identity;
- streaming and read-only gates;
- tool-argument conversion;
- debounced `updateToolCall`;
- `updateToolResponse({ UserAction: 'userEdited' })` behavior;
- final `callTool` execution;
- completed/rejected response rendering.

Calendar feature code must not import cognition clients or generated AI tool schemas.

## 8. Behavioral invariants

The refactor must preserve all of the following:

1. Three FullCalendar pages remain mounted and recyclable in the full block.
2. Occurrence queries retain their complete UTC and local range keys.
3. Only the active viewport page polls while syncing and refetches on window focus.
4. The block's separate target-locator query continues polling while synchronization is in progress.
5. A stale inactive page refetches when it becomes active.
6. Placeholder data remains available while a recycled page changes range.
7. Unsupported ranges do not query or render stale events.
8. Optimistic mutations update every cached occurrence viewport and roll back exact snapshots.
9. All-day API end dates remain exclusive while form/display dates remain inclusive.
10. Drag/resize remains disabled for read-only, cancelled, and recurring occurrences.
11. Drag/resize snapshots remain stable until FullCalendar emits completion callbacks.
12. Drag/resize failures revert FullCalendar state and display the existing failure toast.
13. Timed drag/resize preserves the event timezone when available.
14. Event-chip anchors are replaced when FullCalendar remounts event DOM.
15. Selected details close when a settled active query no longer contains the event.
16. Block event-target requests remain instance-scoped, expire after 15 seconds, and are consumed only by the intended calendar instance.
17. A block target received before mount is delivered through initial block params.
18. Recurring targets without an occurrence key focus only when the locator range resolves uniquely.
19. Mobile swipes cannot begin from controls or event chips.
20. The standalone event composer remains usable outside calendar grid providers.
21. The calendar preference storage key and current defaults remain unchanged.
22. The lazy block definition continues to keep FullCalendar out of the initial application bundle.
23. Any consumer of the reusable grid receives the required `calendar.css` styles without importing the full block.
24. CSS cascade order and FullCalendar vendor selectors remain unchanged unless separately reviewed.
25. Existing feature-flag behavior and `use-calendar-ui-flag` coverage remain intact.

## 9. Phased implementation plan

### Phase 0: Confirm the consumer contracts

**Status: complete.**

Before extracting APIs, document fixed examples for:

- the full block;
- a current-day agenda hover;
- a create-event AI tool card;
- an update-event AI tool card.

Resolve these product questions before implementing each consumer:

- agenda list versus miniature time grid for the hover;
- which event actions the hover exposes;
- whether AI create and update use separate tools;
- confirmation and recurring-event scope behavior for AI updates;
- how streamed tool arguments interact with user edits.

**Review checkpoint:** the reusable API is justified by at least two concrete consumers.

### Phase 1: Characterize high-risk behavior

**Status: complete for high-risk contracts. Broad fixture and snapshot tests were intentionally not added.**

Add focused tests before moving the corresponding logic.

#### Event interaction

Cover editability, render-ID fallback, timed and all-day conversion, timezone preservation, invalid ranges, mutation failure reversion, and stable interaction snapshots.

#### Event form model

Cover defaults, calendar selection conversion, existing-event conversion, all-day boundaries, recurrence normalization, guest normalization, validation, dirty comparison, and external replacement behavior.

#### Pager

Cover initial dates, page rotation, within-range and far-date navigation, view synchronization, missing-page fallback, scroll copying, settings synchronization, and queued-frame cleanup.

#### Composition fixtures

Add focused fixtures/tests proving that:

- a fixed-data grid renders without block providers;
- an agenda renders fixed mapped events without FullCalendar;
- an event form can be externally controlled without split context.

**Review checkpoint:** risky behavior is characterized before structural movement.

### Phase 2: Move the Solid FullCalendar adapter

**Status: complete.**

Move `src/features/calendar/fullcalendar-solid` to `src/lib/fullcalendar-solid` without changing behavior.

Preserve its context, content slots, option resetting, Solid ownership, disposal, registration constraints, and callback ordering.

**Review checkpoint:** adapter tests and type-check pass independently.

### Phase 3: Extract the event draft and form primitives

**Status: complete.**

1. Move active types and pure transformations out of `EventEditorForm.tsx`.
2. Introduce the headless form controller.
3. Convert fields and property pills to consume the scoped controller.
4. Build the default reusable composer form.
5. Adapt the existing block composer to the new form.
6. Delete the unused legacy `EventEditorForm` component after repository-wide reference checks.
7. Preserve the current dirty-close behavior introduced by `event-composer-dirty.ts`.

Do not add cognition behavior in this phase.

**Review checkpoint:** existing timed, all-day, recurring, guest, calendar, create, and edit flows pass.

### Phase 4: Extract occurrence data and agenda primitives

**Status: occurrence adapter complete; agenda and hover deferred to their feature commit.**

1. Extract query/range/mapping state from `CalendarPage` into a headless adapter.
2. Keep active-page polling configurable by the caller.
3. Add the query-free agenda model and rendered primitives.
4. Build a fixed-data agenda fixture.
5. Build the current-day hover as the first real consumer, with lazy query enablement while open.

Prefer the lightweight agenda implementation unless product explicitly requires a miniature time grid.

**Review checkpoint:** hover opening does not load the block shell and displays correct local-day events.

### Phase 5: Extract the query-free calendar grid

**Status: complete.**

1. Separate FullCalendar configuration/rendering from query and mutation ownership.
2. Pass event selection, date selection, and event-time changes as commands.
3. Keep event content slot-based.
4. Extract loading/range presentation from the grid.
5. Import `calendar.css` at the lowest reusable grid entry that guarantees correct styling for every grid consumer.

**Review checkpoint:** a fixed-data grid works without split, block, source-query, or composer context.

### Phase 6: Move the full product composition into `block-calendar`

**Status: complete.**

Create the approved `block-calendar/components` structure.

Move or compose the following there:

- workspace and providers;
- split header;
- side-panel sections;
- setup/permission state;
- selected-event overlay and actions;
- split-specific event composer wrapper;
- hotkey scope;
- block preference/source composition.

Keep `CalendarBlockAdapter` focused on feature gating, analytics, block methods, target lookup, provider composition, and rendering `components/Workspace`.

After this phase, reusable calendar files should not import split-layout or block contexts. Any necessary split wrapper should live in `block-calendar`.

**Review checkpoint:** the complete current block behavior passes before further organization.

### Phase 7: Refactor pager and state ownership

**Status: complete for the current consumers.**

1. Extract testable pager mechanics into a controller.
2. Keep the buffered pager optional.
3. Separate persisted block preferences from controlled display state.
4. Separate source visibility from selection state.
5. Centralize current date, active period, visible interval, and highlighted range through the pager controller.
6. Preserve page rotation, scroll copying, and FullCalendar callback ordering.

Do not require agenda or form consumers to mount pager/display contexts.

### Phase 8: Refactor event details and actions

**Status: complete.**

1. Extract pure details view data and formatting.
2. Keep attendee and details rendering query-free where practical.
3. Inject edit/delete/RSVP commands into reusable details composition.
4. Keep desktop popover, mobile drawer, focus restoration, split composer opening, and delete-dialog behavior in the block composition.
5. Preserve stable event-ID memoization and anchor replacement.

### Phase 9: AI tool consumer

**Status: deferred to a separate feature commit.**

Plan and implement the AI tool end-to-end as a separate reviewed feature using the shared event form primitives.

The calendar refactor supplies the form model and UI. The tool feature separately supplies backend tool definitions, generated schemas, tool registration, execution, and chat persistence.

Use the email tool composer as the behavioral reference, not as a dependency.

**Review checkpoint:** user edits persist into tool arguments, execution uses the edited values, and completed results render read-only.

### Phase 10: Mechanical organization and cleanup

**Status: complete for ownership moves; further folder churn is intentionally deferred until a second consumer needs it.**

Only after ownership boundaries are real:

- move files into their final domain folders;
- normalize names;
- remove dead exports and modules;
- remove the old monolithic `calendar-view.tsx` if no caller remains;
- check import cycles;
- ensure no broad feature barrel changes chunking;
- compare `knip` output with the pre-refactor baseline;
- document FullCalendar DOM and CSS vendor contracts.

Do not split `calendar.css` during the structural refactor. Split block-only styles later only if their selectors and cascade are independently characterized.

## 10. External files likely involved

- `src/components/app/split-layout/componentRegistry.tsx`: register the block-owned composer split wrapper and update moved imports.
- `src/components/app/app-sidebar/sidebar.tsx`: update moved UI-flag imports if necessary.
- `src/components/app/mobile/MobileDock.tsx`: update moved UI-flag imports if necessary.
- `src/features/auth/CalendarPermissionPrompt.tsx`: update moved UI-flag imports.
- `src/features/settings/Email.tsx`: update moved UI-flag imports.
- `src/features/notifications/notification-navigation.ts`: preserve block target navigation.
- `src/features/next-soup/utils.ts`: preserve singleton block targeting.
- `src/lib/core/component/AI/component/tool/calendar/*`: future AI consumer.
- the future hover trigger's owning feature: compose agenda/data primitives.
- `tsconfig.json`: update aliases only if new boundaries require them.

## 11. Validation

Node 25 exposes incomplete experimental web storage in this environment. Run DOM tests with it disabled:

```sh
NODE_OPTIONS=--no-experimental-webstorage \
  bunx vitest run src/features/calendar src/features/block-calendar src/lib/fullcalendar-solid src/lib/queries/calendar

NODE_OPTIONS=--no-experimental-webstorage \
  bunx vitest run src/components/ui/components/Pager
```

Final automated checks:

```sh
bun run check
bun run lint
NODE_OPTIONS=--no-experimental-webstorage bun run test
NODE_OPTIONS=--max-old-space-size=8192 bun run build
```

`bun run knip` is a differential check rather than a clean global gate until the repository baseline is clean. Capture before/after output and reject new findings introduced by this work.

### Manual calendar-block matrix

- month, week, and day transitions;
- today and custom-date navigation;
- week-start, weekend, and time-format settings;
- source visibility;
- timed and all-day create/edit;
- recurrence;
- delete and RSVP;
- drag/resize and rollback;
- selected-event anchoring after refresh;
- notification and event-row targeting;
- loading, syncing, failure, setup, and unsupported-range states;
- desktop and mobile responsive behavior.

### Manual hover matrix

- opens without eagerly querying or loading FullCalendar;
- local-day boundaries around timezone and daylight-saving changes;
- all-day and timed grouping;
- empty, loading, syncing, and failure states;
- event activation behavior;
- nested hover/popover dismissal behavior.

### Manual AI composer matrix

- streamed and complete initial arguments;
- create and update forms;
- timed and all-day values;
- recurrence and guests where supported by the tool contract;
- user edits persisted to the tool call;
- validation and execution errors;
- read-only completed state;
- owner and streaming interaction gates.

## 12. Explicit non-goals

Do not combine these with the structural refactor:

- `/calendar/day`, `/calendar/week`, and `/calendar/month` route-state support;
- FullCalendar dependency upgrades;
- visual redesign or CSS tuning;
- foreign-timezone editing policy;
- reminder and Google Meet editor parity;
- timed/all-day conversion policy changes;
- start-time duration-preservation changes;
- recurrence scope product changes;
- generic infrastructure for unknown future calendar consumers.

Period URLs require a separate split-layout route-state design. Reusable period controls should expose commands and avoid router imports so the block can add that adapter later.

## 13. Suggested commit sequence

1. `test(calendar): characterize composable calendar behavior`
2. `refactor(fullcalendar): move Solid adapter to lib`
3. `refactor(calendar): extract event draft and form primitives`
4. `refactor(calendar): extract occurrence data and agenda primitives`
5. `feat(calendar): add current-day agenda hover`
6. `refactor(calendar): extract query-free calendar grid`
7. `refactor(calendar): move workspace composition to calendar block`
8. `refactor(calendar): separate pager and display controllers`
9. `refactor(calendar): split event details and block actions`
10. `refactor(calendar): organize modules and remove legacy form`
11. `feat(ai): add calendar event tool composer` (separate end-to-end feature)

Stop for review after the form extraction, hover proof, grid extraction, and block composition move.
