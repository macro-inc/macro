# Channel scrolling

`Channel/ThreadList.tsx` uses TanStack Solid Virtual with `anchorTo: 'end'` and
stable message IDs. The virtualizer owns prepend anchoring, following new rows,
and compensation when measured messages grow or shrink. `followOnAppend` is
only enabled when the query includes the newest page. Reading older history
must never be interrupted by incoming messages.

Use the same 1px end tolerance for TanStack, composer/viewport resizing, and saved
positions. Scrolling up beyond rounding tolerance stops following, even a few pixels
from the bottom; returning to the end resumes it.
Acknowledging a send replaces the optimistic message ID, temporarily replacing its
measured height with an estimate. A loose end threshold treats that intermediate
layout as pinned and applies the estimate-to-measurement delta as a backward scroll.
ResizeObserver measurements also run in the current frame: delaying them with
`useAnimationFrameWithResizeObserver` exposes stale row and composer geometry.

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
so our own corrections do not prolong gesture compensation.

Safari wheel scrolling and iOS touch scrolling use a separate logical offset while a gesture is
active. Size and prepend corrections counter-shift the rows instead of writing
`scrollTop`, which interrupts native momentum. Scroll observations and saved
snapshots include that adjustment. After touch release and 150ms without input or scrolling,
the adjustment is removed and committed to the DOM offset in the same task.
The sizer retains its logical height and clips shifted overflow during this period.
Reaching either scroll boundary releases the shifted origin; explicit message,
reply, latest, and pinned viewport/inset navigation flush it before computing targets.
Elastic overscroll must return in bounds before a correction is committed. Touch end
and cancellation listeners stay on the original event target even if its row unmounts.
The `@tanstack/virtual-core` patch adds `useIOSScrollDeferral`, enabled by default.
This list disables it because core deferral updates row positions without applying
the matching scroll correction, which jumps to unrelated messages during a prepend.
Channel compensation keeps logical row positions and offsets synchronized instead.
While compensation is active, remeasuring a row entirely above the viewport also
preserves the anchor when scrolling upward. The core's default backward-scroll
exception otherwise lets late-loading images move the message being read. A row
that spans the viewport's top is not compensated when its lower content grows.

Message images reserve a responsive box from attachment dimensions, with the loading
placeholder overlaid inside it. Keep the border on the frame: a border on the image
can change portrait/landscape sizing when intrinsic dimensions become available.

Message IDs also key Solid's rendered components, preserving editors and expanded
threads across pagination. `Key` owns each row's virtual-item accessor; a shared
map lookup can disappear while a queued measurement effect is still running.
Measurement effects track index changes and register rows in a microtask after child
effects fill their Markdown, still before paint. Measuring the empty shell can
temporarily shrink the sizer and clamp the browser scroll position, especially
with floating mobile insets. Later size changes belong to ResizeObserver.
`targetId` keeps the pending thread mounted for precise navigation to nested replies;
only the list translates that ID into a virtual index. Snapshot
restoration pairs the offset with `takeSnapshot()`.
Pagination callbacks require user scroll intent; measurement corrections alone
must not fetch more history.
