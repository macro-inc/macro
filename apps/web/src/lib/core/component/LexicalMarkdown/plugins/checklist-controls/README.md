# Checklist controls

`TaskListControlsRenderer` uses the existing Source collector and planner. Both
renderers share the actual contact/task queries in `task-list-facts` and markup
in `TaskListBar`. The native renderer never calls the Source planner.

The native plan host is session-owned. Construct it before creating the session,
pass its observer through `latestPublished`, and call `ready(view)` only from the
public runtime exposed after the real Initialize fence. Visual overlay remounts
reuse this host. A second host for the same actual view is rejected, including
after disposal; replacing the consumer on an existing session is unsupported.

Observation copies flat published Date properties and consumes the typed
`group-b.checklist-plan-updates` effect. It never enters a native receiver.
Facts admission runs after observation returns, uses serialized `inputSettled`
with explicit KeepModel selection, and includes the real current generation.
The host sends a new facts revision only for changed provider/date facts or its
host-clock midnight rollover. Task deletion uses the actual query's missing-task
result. Names and task IDs retain their actual provider identities.

Typing with unchanged facts makes no extra planner query or facts input. A new
Date string requires its raw Date observation; that explicit refresh is a
counted input. Until then, an invalid-calendar result has no JS bucket fallback.
Initial setup, provider refreshes, and midnight rollover inputs also count.

The delivery reducer consumes sequences in wire order across packets. A retained
receipt from another generation advances only receipt metadata; it cannot
modify the current view. Current-generation deltas require an actual reset.
A gap, malformed delta, or unknown admission result retires optional presentation
and reports the cause while the document's normal output and IO continue.
Unsupported planner results and non-string stored assignee identities have no
fallback bar. They remain explicit consumer coverage gaps.

Bind the host and renderer only to a matching sidecar producer and real
providers. Retirement releases the flat presentation data; it never acknowledges
or deletes native delivery authority. Pure DTO tests are not native
receipt/transfer proof. Ordinary-session lifetime tests exercise ownership and
cleanup; refresh controls require the matching producer and compare its real
receipts against the Source collector and planner.

Filter changes use the closed `group-b.checklist-settings-intent` input. The
queued native session chooses the existing document writer for Edit access or a
session-owned Rust-planned presentation override for Read and Comment access.
The latter changes no canonical model, selection, history, CRDT version or WAL.
Source also changes its local NodeState, so the native canonical serializedState
still differs from Source's reader-local state; there is no query mask.

Capture settings and the last actually decoded current-generation plan sequence
in the same UI turn. The sequence is a stale-view comparison, not access or
transfer authority. Admission keeps the intended generation and actual list/bar
identity, checks retirement around serialization and at the queued turn, and
uses KeepModel without a selection query. Stale inputs return before Core
dispatch; only native deliveries change visible filters.

Any actual access-value change clears overrides and shows stored settings,
including an upgrade to Edit; an equal-value refresh preserves them. Nothing
local is promoted into a later document write. Successful remote application,
actual Core replacement and binding clear drop local choices; control-only
remounts reuse the same session host. Remote application errors alone retain choices for surviving
lists until a later accepted reset, replacement or disposal. That error-path
behavior is an explicitly unqualified Source difference. Source piggyback on
upgrade is not proven; the observed binding change did not distinguish editor
replacement from root rebinding. Replaced-editor-version coverage remains open.
