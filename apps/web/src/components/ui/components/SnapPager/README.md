# SnapPager

A generic, endless, native horizontal scroll ring. Import `SnapPager` and
`createSnapPager` from `./SnapPager`. The browser owns drag and momentum: there
are no touchmove handlers, transforms, preventDefault calls, or custom inertia.
Passive gesture listeners temporarily disable CSS snapping. Once native scrolling
ends, the pager requests native smooth alignment before recycling any page.
Horizontal wheel input follows the same path; vertical input is ignored.

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

At rest, CSS uses proximity snapping with `scroll-snap-stop: normal`. During a
gesture it is disabled so it cannot force an early page decision. A slow drag
commits only beyond half a page. A release faster than 0.5 CSS px/ms, sampled
within 80ms and traveling at least 10% of a page (capped at 40px), is a flick.
Native momentum can cross multiple pages. `scrollend` starts smooth alignment;
only its final `scrollend` recycles the ring and reports the move. Engines without
`scrollend` use a 350ms quiet fallback. No timer substitutes for native `scrollend`
when supported. Held gestures do not settle. `onScrollStart` lets callers pause
queued render work; even a zero-move settlement releases that pause.
Update recycled content without remounting the stable page key. `reset()` explicitly
returns to the initial ring without calling `onSettle`. `setLocked(true)` freezes
horizontal navigation; unlock settles the current location. Locked resizes retain
the active page. Off-screen pages are inert and aria-hidden. The caller owns keyboard
navigation. Viewport owns resize observation, listener cleanup, and attachment.

Calendar's `CalendarPagerContext` and `Workspace` use this component for five
periods on phone and desktop. The original shared Pager remains unchanged for
other consumers. Native gesture/trackpad behavior still needs browser verification.
