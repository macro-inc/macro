# SplitRouter leave guards

`useBeforeLeave` runs when a navigation leaves the registering route, closes its
pane, or changes an explicitly watched search namespace. Returning `false` keeps
the current destination. Solid cleanup only unregisters the guard. Routes that
share a `mountKey` count as one route: moving between them keeps the view
mounted and does not leave it.

Use `context.onCommit(callback)` to stage a synchronous side effect that must run
only after the navigation commits. Capture outgoing state while the guard runs;
the callback runs after the new panes and URL are applied, when the outgoing
component can already be disposed.

Callbacks belong to the navigation, not the guard phase or the mounted component.
Refusal, cancellation, supersession, disposal, and failed application discard all
staged callbacks. Unchanged navigation and activation of another content owner do
not publish callbacks. Late registration after the guard phase ends is ignored.
A throwing callback is logged without changing the successful navigation result
or preventing later callbacks from running.

Preload and middleware errors that the router recovers from still allow commit
callbacks when navigation commits. Host-leave permission checks cannot confirm
that the host actually navigates, so their `onCommit` registration is a no-op.

# Layout tree

`panes.layout()` is how the open panes tile: a tree of `row` (side by side)
and `column` (stacked) splits with each child's share. Its panes in
depth-first order are `panes()`, so positional `sN.*` search keys and history
state are unchanged. A new pane either splits an open pane (placement
`{ split, side }`) or becomes a column at `insertAt`. Removing a pane collapses
its split; moving panes keeps the tiles and refills them in the new order.

The URL records the tree only when some panes are stacked, in the `layout`
search key: `p` is a pane and `r<n>`/`c<n>` a split of the next `n` shapes, so a
pane beside two stacked panes is `/a/~/b/~/c?layout=r2pc2pp`. Without the key,
or when it doesn't fit the URL's panes, the panes sit in one row. Sizes stay
out of the URL; `resizeLayout` changes them, `layoutSnapshot` captures them,
and `restoreLayout` brings them back.
