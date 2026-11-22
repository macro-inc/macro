# SnapPager

A generic, endless, native horizontal scroll-snap ring. Import `SnapPager` and
`createSnapPager` from `./SnapPager`. The browser owns drag, momentum, and snap:
there are no touchmove handlers, transforms, preventDefault calls, or custom inertia.
Passive start/end/cancel listeners only defer the settlement fallback during a held
gesture; they do not move the track.

```tsx
const pager = createSnapPager({
  onSettle(moved) {
    // Update the period by moved steps synchronously, including recycled data.
  },
});

<SnapPager.Root controller={pager}>
  <SnapPager.Viewport aria-label="Periods" class="h-96">
    <For each={pager.pages()}>
      {(page) => (
        <SnapPager.Page page={page}>
          <Period offset={page.offset()} pageKey={page.key} />
        </SnapPager.Page>
      )}
    </For>
  </SnapPager.Viewport>
</SnapPager.Root>;
```

`pageCount` defaults to five and accepts odd integers of at least three. `pages()`
keeps its descriptors and keys stable; `pageOrder()` lists their current spatial
order. `activePage()` returns the middle key. Each descriptor exposes `position()`
(its physical slot) and `offset()` (relative to the active page). Only recycled
slots change position after a settled swipe. `position()` on the controller tracks
logical displacement since `reset()`.

`next()` and `previous()` accumulate rapid requests. `goTo(offset)` targets an
offset from the committed page and supersedes an earlier target. Far jumps are
instant when idle and wait for native scrolling to settle when a fling is active.
Single steps use native smooth scrolling except under reduced motion. `scrollend`
commits immediately; a 100ms idle-scroll fallback supports older browsers. Neither
path recycles a held gesture. A later gesture cancels pending commands through
`onNavigationCancel`; continuing a held swipe also cancels a date request made
before that continued movement.

`onSettle(moved)` runs after rotation and before queued navigation. A canceled
programmatic move reports zero; re-centering itself does not report another move.
Update recycled content without remounting the stable page key. `reset()` explicitly
returns to the initial ring without calling `onSettle`. `setLocked(true)` freezes
horizontal navigation; unlock settles the current location. Locked resizes retain
the active page. Off-screen pages are inert and aria-hidden. The caller owns keyboard
navigation. Viewport owns resize observation, listener cleanup, and attachment.

Calendar's `CalendarPagerContext` and `Workspace` use this component for five
periods on phone and desktop. The original shared Pager remains unchanged for
other consumers. Native gesture/trackpad behavior still needs browser verification.
