---
name: add-tour
description: Add or change an in-app feature tour (a view's guided flyover) in the web app. Use when adding a tour to a view, adding or editing tour steps, pointing a step at a new control, or when a step's target needs something opened first.
---

# Add or change an in-app tour

Frontend only. Two layers:

| Layer | Where | What |
|---|---|---|
| Primitive | `apps/web/src/components/ui/components/Tour/` | `Tour.*` parts, `defineTourTargets`, `tourTarget`. Generic; no app knowledge. |
| App | `apps/web/src/features/tours/` | `ViewTour` (desktop gate, per-user dismissal, connector/video CTAs), `defineViewTour`. |
| Per view | `apps/web/src/features/<view>/tour.ts` | The view's targets and its tour definition. |

Read an existing `tour.ts` first. `channels-view/tour.ts` and
`agents-view/tour.ts` show entries; `calendar-view/tour.ts` shows the sidebar
toggle entry.

## 1. Declare targets

In the view's `tour.ts`:

```ts
export const REPORTS_TOUR = defineTourTargets('reports', ['filters', 'chart']);
```

- Ids are `namespace.name`. Use the view's name as the namespace.
- Targets are view-scoped: they resolve only inside the tour's split. Pass
  `{ scope: 'app' }` only for shared chrome outside any split (see
  `command/sidebar/tour.ts`).
- Reuse shared targets before adding new ones:
  - `VIEW_SHELL_TOUR` (`@app/components/view-shell`): `aside`, `main`, `topBar`, `sidebarToggle`. Every `ViewShell` registers these.
  - `SOUP_TOUR` (`features/next-soup/tour.ts`): `list`.
  - `CHANNEL_TOUR` (`features/channel/tour.ts`): `messages`, `composer`, `call`.
  - `APP_TOUR` (`features/command/sidebar/tour.ts`): `createMenu`.

Never target with selectors, `data-*` attributes, or `aria-label` lookups. If
the control you want isn't registered, register it (step 2).

## 2. Attach targets

```tsx
<div ref={tourTarget(REPORTS_TOUR.filters)}>…</div>
```

- The element must have a box. `display: contents` wrappers never resolve;
  attach to a real element.
- If the element already has a ref, call both:
  `ref={(el) => { existing(el); target(el); }}` with
  `const target = tourTarget(...)` created in the component body, or use
  `mergeRefs` from `@solid-primitives/refs`.
- For a component that doesn't forward `ref`, add a `ref` prop that it passes
  to its root (see `SidebarCreateButton`).
- A lower-level feature may import targets from the view that owns the tour
  (for example, `features/calendar` imports `CALENDAR_TOUR`).

## 3. Define the tour

```ts
export const reportsTour = defineViewTour({
  id: 'reports',            // dismissal key: never reuse or rename casually
  title: 'Reports',
  connector: { kind: 'mcp', label: 'Linear', tools: ['Linear'] }, // optional
  video: { youtubeId: '…', title: '…', duration: '1:23' },          // optional
  steps: [
    { target: REPORTS_TOUR.filters, title: '…', description: '…' },
    { target: [REPORTS_TOUR.chart, VIEW_SHELL_TOUR.main], title: '…', description: '…' },
  ],
});
```

- `target` may be a list; the first shown one wins.
- A step without `target` floats in the split.
- `missingHint` explains how to reach an unavailable feature when there's no entry.
- `placement` (a floating-ui `Placement`) overrides the default `right-start`.

## 4. Never navigate for the user: use an entry

If a step's target is behind something (a collapsed sidebar, another page, an
unopened item), don't open it from the tour. Give the step an `entry`:

```ts
{
  target: REPORTS_TOUR.chart,
  entry: VIEW_SHELL_TOUR.sidebarToggle,
  entryLabel: 'Open the sidebar to continue the tour',
  title: '…',
  description: '…',
}
```

While the target is missing and the entry is shown, the card hides, a beacon
marks the entry, and a small hint beside it shows `entryLabel` with Skip and
×. Pressing the entry, or the target appearing any other way, resumes the
step. Register the entry control as a target like any other.

- Keep `entryLabel` short and imperative: "Open a channel or DM to continue".
- **Chain entries** when the entry itself can be hidden. The first shown one
  wins, so list the real control first and the sidebar toggle last:
  `entry: [CHANNELS_TOUR.conversation, VIEW_SHELL_TOUR.sidebarToggle]`. With
  the sidebar collapsed the beacon marks the toggle; once it opens, the beacon
  moves to the row.
- Any step whose target or entry lives in the view's sidebar needs
  `VIEW_SHELL_TOUR.sidebarToggle` as its last entry.
- Point entries at a specific control, not a large container. When many
  elements share a target (every conversation row), the top-most one on
  screen is used.

## 5. Mount it

Mount once, inside the view's split (usually in `ViewShell.Main` or next to the
list):

```tsx
<ViewTour tour={reportsTour} />
<ViewTour tour={tasksTour} actions={<ImportLinearAction />} />  // extra CTAs
```

- For `SoupView`-based routes, pass it through the slot:
  `<SoupView … tour={<ViewTour tour={callsTour} />} />`.
- Don't put it inside a `<Show>` branch that remounts on navigation, or the
  tour restarts at step 1.
- Don't gate it on desktop yourself; `ViewTour` already does.
- Don't pass step callbacks that change pages or open panels.

## 6. Test and document

- Unit behavior of the primitive lives in `Tour/Tour.test.tsx` and app behavior
  in `features/tours/ViewTour.test.tsx`; add cases there when you change them.
- The primitive's gallery page is `Tour/Tour.docs.tsx`.
- Check it in a browser: on localhost the tour reopens on every mount. Walk
  every step, including one that waits on an entry, once with the sidebar
  open and once collapsed.
- Update `docs/AGENT_GUIDE/view-tours.md` when a view gains a tour or its steps
  change.
