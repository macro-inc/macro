# Channel scrolling

`Channel/ThreadList.tsx` uses TanStack Solid Virtual with `anchorTo: 'end'` and
stable message IDs. The virtualizer owns prepend anchoring, following new rows,
and compensation when measured messages grow or shrink. `followOnAppend` is
only enabled when the query includes the newest page. Reading older history
must never be interrupted by incoming messages.

The list exposes three navigation operations: `scrollToLatest`, `scrollToMessage`,
and `scrollToElement`. Message navigation can include keyboard intent for pagination.
`initialPosition` chooses latest, a mounted target, or a saved snapshot; these are mutually exclusive. `onReady` publishes the handle after the
first measured layout and can return a cleanup to release it on unmount.

`createScrollLifecycle` owns initial positioning: waiting for layout → waiting for
an element or ready → disposed. Layout notifications advance it in the measurement
microtask. Element positioning, a newer navigation, or a user scroll cancels the
fallback permanently. There is no effect watching an initial-scroll boolean.
`Channel` keeps one pending latest request while the query loads and the rendered
list catches up. A message navigation or user scroll cancels it; stale request
completions cannot move the viewport. A pagination error still permits navigation
within retained messages. `onScroll` publishes state and a snapshot captured
together before callers can start another navigation, and attempts the pending
latest request against that layout.
The remaining list effects bridge changing insets and row indexes to DOM measurement.

The virtualizer stays disabled while the message index is empty, so it evaluates
the initial bottom offset against the first loaded page instead of caching zero.
Saved sizes also seed that offset, keeping the first rendered range at latest in
channels whose measured rows are much taller than the default estimate.
Mounted rows read their current DOM height synchronously, including when restoring
saved measurements. Initial navigation to latest runs after those measurements in
a microtask before paint. Using cached heights until ResizeObserver fires exposes
the wrong bottom position, even when the scrollbar is already at its end. History
uses `initialOffset`; replaying the saved offset after measuring would discard the
anchor corrections for changed rows.

Rows are positioned inside one sizer that includes the floating header/composer
insets. Short conversations are bottom aligned. Before TanStack writes a scroll
correction, `scrollToFn` synchronously commits the current total to the sizer;
otherwise a growing last row can clamp the scroll against the old DOM extent.
Viewport and inset changes explicitly scroll to the end only if previously pinned.
The offset observer distinguishes instant programmatic scrolls from user scrolling,
so iOS does not replay deferred momentum adjustments after a navigation has already
accounted for those measurements. Actual touch/momentum deferral remains in the core.

Message IDs also key Solid's rendered components, preserving editors and expanded
threads across pagination. `Key` owns each row's virtual-item accessor; a shared
map lookup can disappear while a queued measurement effect is still running.
Measurement effects track index changes only, leaving size changes to ResizeObserver.
`targetId` keeps the pending thread mounted for precise navigation to nested replies;
only the list translates that ID into a virtual index. Snapshot
restoration pairs the offset with `takeSnapshot()`.
Pagination callbacks require user scroll intent; measurement corrections alone
must not fetch more history.
