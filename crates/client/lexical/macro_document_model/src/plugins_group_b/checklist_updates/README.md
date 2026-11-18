# Derived checklist deliveries

`group-b.set-checklist-facts` configures the session's checklist producer with
`factsVersion` (canonical positive decimal u64 string), `tasks`, `names` and raw
`calendar` observations. Unknown fields and malformed facts are refused; there
is no native date parser.

Equal revisions require identical facts, and an identical retry re-emits any
pending delivery with the same sequence. Older or conflicting revisions are
refused, and a new revision cannot replace an untransferred delivery. After
transfer, `rebind: true` with the same revision and facts requests a full reset
for a remounted consumer.

Commit dirty keys and their ancestors identify changed direct-root checklists;
only those lists are recomputed after replay, resync and cursor handling, and
identical presentations emit no delta. A facts change recomputes every list in
document order. The producer retains keys only, never commits or snapshots.

Output carries `group-b.checklist-plan-updates`: `delta` (generation,
factsVersion, sequence, reset, ordered lists) or `cleared` (generation,
sequence). List entries replace, remove or patch a key; ordinary deltas omit
item text, checked, status, priority and due. Arrays change by remove /
place-after, never by reordering lookup maps.

The presentation baseline advances only after transfer: a pending delivery is
acknowledged when its exact receipt is exposed in FIFO order, and encoding
failure keeps it pending without allocating a new sequence. WASM `takeOutput`
and FFI output conversion acknowledge receipts only after encoding succeeds.

## Reader presentation choices

Read and Comment sessions keep `group-b.checklist-settings-intent` overrides in
this producer, keyed by direct-root checklist key; the same planner derives both
stored and overridden plans without model writes. An access change drops every
override and closes settings admission until a strictly newer delivery is
installed. Successful remote application drops overrides; remote errors keep
them until a later reset, replacement or disposal. Canonical serialization
always exposes stored settings.
