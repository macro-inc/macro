# SnapPager

A generic, endless horizontal page ring. Its default mode leaves drag and momentum
to the browser, without scroll-driving touch handlers or custom inertia. Passive
gesture listeners temporarily disable CSS snapping. Native scroll completion
starts smooth alignment before page recycling. Vertical input is left alone.

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
track under a finger. Rapid queued commands never enable the programmatic quiet
timer during observed native scrolling. After release without any scroll event,
a 150ms no-op window permits recovery only if `scrollLeft` also stays unchanged.
Any arriving scroll cancels that timer; a scroll arriving after recovery takes
native ownership back and waits for `scrollend`. Passive capture listeners track
contact lifecycle even when nested controls consume release events. Releases
outside a contact started in the viewport do nothing. This bounded heuristic favors
recovery over an indefinitely stuck pager; it is not compositor-completion proof.
A later gesture cancels pending commands through
`onNavigationCancel`.

Desktop hosts can set `instantWheel` and `rapidPressMs: 300`. Horizontal-dominant
wheel input past 4px jumps one period instantly and blocks native horizontal
overflow; events less than 180ms apart belong to the same gesture, including
inertia. `onWheelNavigate` updates host date anchors before the jump. A wheel
gesture interrupts a button animation at the combined target. Desktop period
buttons ignore presses while a native gesture or smooth animation is active;
`canStep()` lets the host avoid changing its date anchor for ignored presses.
After animation completes, every press is accepted: idle presses inside the
300ms burst jump, and a quiet interval re-arms smooth navigation. One aggregate
settlement follows the quiet interval. Phone swipes keep the default native path.

At rest, CSS uses proximity snapping with `scroll-snap-stop: normal`. During a
gesture it is disabled so it cannot force an early page decision. A slow drag
commits only beyond half a page. A release faster than 0.5 CSS px/ms, sampled
within 80ms and traveling at least 10% of a page (capped at 40px), is a flick.
Native momentum can cross multiple pages. `scrollend` starts smooth alignment;
only its final `scrollend` recycles the ring and reports the move. Engines without
`scrollend` use a 350ms quiet fallback. No timer substitutes for native `scrollend`
when supported and scrolling was observed. Held gestures do not settle. `onScrollStart` lets callers pause
queued render work; even a zero-move settlement releases that pause.
Update recycled content without remounting the stable page key. `reset()` explicitly
returns to the initial ring without calling `onSettle`. `setLocked(true)` freezes
horizontal navigation; unlock settles the current location. Locked resizes retain
the active page. Off-screen pages are inert and aria-hidden. The caller owns keyboard
navigation. Viewport owns resize observation, listener cleanup, and attachment.
Width changes re-snap the committed page using the new measurement without
changing the logical period. An unfinished button command keeps its destination;
resizing during a held or native gesture leaves settlement with that gesture.

Calendar's `CalendarPagerContext` and `Workspace` use this component for five
periods on phone and desktop. The original shared Pager remains unchanged for
other consumers. Native gesture/trackpad behavior still needs browser verification.
