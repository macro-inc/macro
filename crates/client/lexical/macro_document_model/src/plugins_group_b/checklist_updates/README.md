# Derived checklist deliveries

The initial/on-demand `group-b.checklist-plan` query remains stateless. The
ordinary `group-b.set-checklist-facts` input configures the session producer with
`factsVersion`, `tasks`, `names`, and raw `calendar` observations. `factsVersion`
is a canonical positive decimal u64 string, independent of model versions.
Unknown fields and malformed typed facts are refused. Missing due observations
produce `invalidCalendarFacts`; the host must attach the observation at a real
provider/date/paste input or perform a counted explicit refresh. There is no
native date parser or calendar bucket fallback.

Equal revisions require identical facts. An identical retry re-emits any pending
delivery with the same sequence. Older/conflicting revisions are refused. A new
revision cannot replace an untransferred pending delivery. After transfer,
`rebind:true` with the same revision and identical facts requests a full current
reset for a remounted native consumer. It is a counted setup input, not a new
RPC or a document mutation. Read/comment sessions may update these host facts;
ordinary document admission still rechecks current access.

Actual commit dirty keys and their ancestors in both snapshots identify changed
direct-root checklists. Only keys are retained, including real early commits on
error paths. Final plans are derived after replay, resync and cursor handling.
An unrelated edit recomputes no list; an ordinary text edit inside one checklist
recomputes that list. If the resulting presentation is identical, no delta is
created. Facts changes recompute all current lists in document order. No commit,
snapshot, read graph, or transaction is retained by the producer.

The existing output carries `group-b.checklist-plan-updates`. Deliveries are
`delta` (generation, factsVersion, sequence, reset, ordered lists) or `cleared`
(generation, sequence). A never-configured producer emits nothing. Only an
accepted replacement or actual binding clear requests `cleared`; reset requests
that fail before replacement do not clear facts. Sequence strings are monotonic
per actual session and never graph authority.

List entries replace, remove, or patch a key. Bar data includes normalized
settings, filter count, active state, task presence, progress, ordered row dim
facts, and ordered item keys/task IDs/assignees. Ordinary deltas omit item text,
checked, status, priority and due fields. Array changes use remove/place-after
and field updates; lookup maps never reorder document rows. The UI retains its
existing name collation; native preserves first-seen ID/name associations.
Unsupported filter/prototype-key coverage and invalid calendar facts remain
explicit whole-list results, with the original settings value unchanged.

The presentation baseline advances only after transfer. Pending deliveries hold
private exact receipt identities and their prospective changes. Encoding failure
retains them; retries do not allocate another sequence. Exposure acknowledges
only a matching FIFO receipt. Another producer's same sequence, an out-of-order
receipt, or an already exposed receipt does not acknowledge debt. Untransferred
control/import outputs may include the retained ordered delivery prefix.

WASM binds receipt metadata to the successfully encoded packet. `takeOutput`
first exposes its existing decorator observation, then infallibly commits exactly
that packet's plan receipts before returning bytes. The existing direct-buffer
telemetry append failure behavior is preserved: successful encoding replaces
bytes, decorator staging and plan receipt metadata together before append.
`initialize_view` prepares a separate full reset, encodes it with Initialize,
and commits the draft only after encoding and decorator exposure succeed. A
failed draft leaves the old baseline and pending deliveries intact. This native
exposure convention does not prove JavaScript applied DOM changes.

FFI converts the actual complete output into owned records before acknowledging
its receipts. Conversion failure retains pending plans. The existing PluginEvent
transport contains `Some(actual serialized typed delivery)`; no lexical event or
new binding variant is synthesized. Remount uses the explicit rebind setup input.

Covered steady edits add no planner query or API call. Initial mount/on-demand
queries and provider refreshes remain counted. Component recomputation and JSON
size tests are not physical crossing, byte, reference-slot, browser, or full
compatibility acceptance; all output bytes and native crossings remain visible
to the physical collector.

## Reader presentation choices

The closed `group-b.checklist-settings-intent` input selects the existing
persisted writer only after actual queued Edit admission. Read and Comment
instead retain exact settings values in this producer, keyed by actual current
direct-root checklist keys. Explicit empty filters remain an override; removing
an override restores stored settings. The same Rust planner derives both paths,
without model transactions, selection/history changes, CRDT writes or WAL.

An actual access-value change drops every override immediately and closes
settings admission. Equal access refreshes preserve overrides. Admission reopens
only after the final-output epilogue installs a checked strictly newer real
delivery sequence, or a prepared reset is actually adopted after transfer.
Missing facts or failed/exhausted allocation stay closed. The freshness check
uses the latest issued sequence, including pending deliveries, never the
exposed baseline; failed encoding cannot revive an old queued write.

A visual remount draft carries the local map without changing the live producer
until adoption. Accepted Core replacement or binding clear drops it. Actual
successful remote application drops existing overrides; ordinary remote updates
without overrides retain the existing affected-key recomputation. Remote error paths
only observe actual committed arrays and retain surviving choices until a
later accepted reset, replacement or disposal. This error behavior is not
qualified as Source parity. Native canonical serialization continues to expose
stored settings, unlike Source's local reader NodeState.
