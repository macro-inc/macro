# SnapPager

A generic, endless, native horizontal scroll-snap ring. Import `SnapPager` and
`createSnapPager` from `./SnapPager`. The browser owns drag, momentum, and snap:
there are no touchmove handlers, transforms, preventDefault calls, or custom inertia.
Passive start/end/cancel listeners defer settlement during a held gesture.
Horizontal wheel input identifies trackpad ownership without driving the track;
vertical wheel input leaves the pager alone.

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

`next()`, `previous()`, and `goTo(offset)` add to the current command target;
`targetPosition()` exposes that destination. Single unhurried steps use native
smooth scrolling, except under reduced motion. A second press within
`SNAP_RAPID_PRESS_MS` (180ms), or a target outside the ring, jumps immediately.
Rapid presses report one aggregate `onSettle(moved)` after controls go quiet, so
callers can prepare the final data range without loading every skipped period.
A request during a native gesture waits until it settles instead of moving the
track under a finger. A later gesture cancels pending commands through
`onNavigationCancel`.

Native snapping remains mandatory with `scroll-snap-stop: normal`, allowing
strong flings to cross several pages. `scrollend` commits at rest; the fallback
waits `SNAP_SETTLE_DELAY_MS` (180ms) after the last scroll instead of 100ms, so
brief momentum pauses do not recycle the track early. Neither path recycles a
held gesture. A canceled programmatic move reports zero; re-centering itself
does not report another move.
Update recycled content without remounting the stable page key. `reset()` explicitly
returns to the initial ring without calling `onSettle`. `setLocked(true)` freezes
horizontal navigation; unlock settles the current location. Locked resizes retain
the active page. Off-screen pages are inert and aria-hidden. The caller owns keyboard
navigation. Viewport owns resize observation, listener cleanup, and attachment.

Calendar's `CalendarPagerContext` and `Workspace` use this component for five
periods on phone and desktop. The original shared Pager remains unchanged for
other consumers. Native gesture/trackpad behavior still needs browser verification.
