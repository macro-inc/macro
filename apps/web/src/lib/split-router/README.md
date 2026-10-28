# SplitRouter leave guards

`useBeforeLeave` runs when a navigation leaves the registering route, closes its
pane, or changes an explicitly watched search namespace. Returning `false` keeps
the current destination. Solid cleanup only unregisters the guard.

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
