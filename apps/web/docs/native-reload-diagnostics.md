# Frontend checkpoints for native reloads

The frontend also saves one content-free document checkpoint in session storage,
including on older binaries. It updates at startup, router commits, visibility
changes, `pagehide`, and same-document bfcache restoration; there is no polling or native
IPC. The next startup's `previous_document_*` properties report the last recorded
visibility and whether `pagehide` was observed, including its `persisted` bit.
Navigation checkpoints include commit, pane, history-entry, and saved-entry-state
counts. Commits in one JavaScript turn coalesce into one checkpoint after pane
cleanup; these are not click counts. No routes, result rows, or entry IDs are
stored. Counts can reveal growing retained navigation state, but do not measure
WebContent memory or establish a memory-related termination.
Missing, malformed, future, or more-than-24-hour-old checkpoints report unavailable
coverage. Logout clears the checkpoint and stops its listeners. A document that
has lost checkpoint ownership cannot overwrite its successor's data.
If that older document resumes from bfcache, it invalidates the checkpoint so
the next startup reports unknown instead of attributing its exit to a successor.
These are last-observed lifecycle signals: missing `pagehide` supports an abrupt
exit hypothesis but does not prove a crash, and `persisted` is bfcache intent,
not proof a document was later restored. This checkpoint cannot identify why
WebKit terminated; correlate it with the native counters and device diagnostics.

When investigating a repeat, compare the native launch ID, termination counter,
reload request/dispatch markers, and the recovered heartbeat/lifecycle events. On new binaries,
`previous_document_last_*` names the route and entity type the document was
navigating to. The same native launch with a larger termination counter confirms WebContent
recovery. A memory warning supports pressure but does not identify the kill reason.
For the OS reason, obtain the incident's iPhone Analytics Data report (Settings →
Privacy & Security → Analytics & Improvements → Analytics Data): a matching
`com.apple.WebKit.WebContent-…` crash report, or a `JetsamEvent-…` listing
`com.apple.WebKit.WebContent` as killed, near the termination timestamp. On
macOS, use Console → Crash Reports.
Do not use the host app's memory footprint as the renderer's memory footprint;
WebContent runs in a separate process. A change in native launch ID alone cannot
distinguish a crash, OS termination, or the user relaunching the app.

For native buffers, reload markers, termination counters, and binary-release
requirements, see [native reload diagnostics](../tauri/src-tauri/README.md#diagnosing-unexpected-webview-reloads).
