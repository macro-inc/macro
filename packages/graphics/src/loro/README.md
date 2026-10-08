# Two-peer scene experiment

Status reviewed 2026-09-28. See the [main progress plan](../../../../docs/GRAPHICS_PARITY.md).
Automated mapping coverage now includes pencil, rich text/labels, connectors and
media/document references. Full Canvas Next integration is deferred while the
[legacy bridge and colors](../../../../docs/CANVAS_LEGACY_BRIDGE.md) take priority.

`@macro-inc/graphics/loro` is an experimental adapter with an in-memory transport
harness used by tests. It uses the workspace Loro version (1.16.3). No SyncService,
network requests, local storage, or server changes are involved.

The root graphics export stays framework/DOM/Loro-free. `GraphicsBackend` is the
small document/history contract; `createGraphicsEditorFromBackend` proposes local
commits and renders backend snapshots. Loro is authoritative. The editor does not
also maintain snapshot undo for these documents. The owner disposes each editor
before its backend. Memory-backed hosts keep their original behavior.

## Representation

- A LoroTree owns containment and sibling ordering. Node data retains the stable
  graphics ID and immutable kind. The surface is the implicit root of the forest.
- Each node has one coherent `pose` register: local matrix, geometry, coordinate
  parent ID, and a captured world matrix. Fill and stroke are separate registers,
  so moving and restyling the same shape can merge independently.
- Ordered Loro children project to unique core sort keys. These keys are derived,
  not CRDT fields; concurrent key collisions are handled by Loro's ordered tree.
  Core commands become moves of affected tree nodes, not full-list replacements.
- A gesture makes one commit and one undo step. Selection, camera, active tool and
  previews remain local editor state. A separate ephemeral channel broadcasts
  read-only cursor, selection and pending-gesture snapshots while connected.
- Incoming changes cancel local transform/drawing previews. Intent rebasing is
  deliberately deferred. Imported changes do not echo back into the transport.

## Conflict policy under evaluation

Loro resolves competing values of the same pose register. Independent style fields
merge separately. Its tree resolves competing parents and prevents cycles.

A winning tree parent can differ from the coordinate parent recorded by the winning
pose. In that case the projection uses the pose's captured world matrix, expressed
relative to the actual parent. This keeps both replicas valid and avoids interpreting
an old local matrix in the wrong coordinate space. It is a derived interpretation:
no repair operations or reconciliation loop are emitted.

**This is a policy to evaluate, not a settled production schema.** Such a node stays
anchored in world space through subsequent parent transforms until it receives a
new pose edit. Adapter diagnostics report these nodes. Captured world pose is the
winning edit's pose, not a guarantee that both concurrent geometric intentions
survive. Concurrent edits to one pose choose one coherent result.

The native Loro UndoManager records only local operations, with merging disabled
and a 100-step bound. Independent remote properties survive undo. Undo of a field
that another peer subsequently overwrote can restore the pre-local value; redo can
restore the remote value. Undoing a deletion restores pre-delete node data, even
when another peer edited that node concurrently. The tests explicitly capture
these behaviors. Snapshot undo
is never applied to a shared document. Deleting a group while another peer extracts
a child lets the extracted child survive; opposite reparents converge without cycles.

## Test transport

The automated collaboration tests give Alice and Bob independent editors backed by
an in-memory transport. Tests can pause delivery, flush queued updates, reconnect,
and add artificial latency. Disposing the harness clears editors, histories,
queued messages and timers so packets cannot leak between cases.

## Awareness boundary

`createGraphicsPresence` observes the editor through its existing subscriptions.
It uses Loro's `EphemeralStore`, independently of the document and UndoManager.
Its packets contain identity/color, a world-space cursor, selected root IDs, the
document clock and an optional pending action. Transform previews flatten selected
descendants into world-space shape outlines; drawing and marquee previews have
their own payloads. Neither sending nor receiving presence issues editor commands.

`@macro-inc/graphics/loro/solid` exports `CollaborativeGraphicsSurface`, composing
the unchanged `GraphicsSurface` with a sibling overlay and cursor listener.
Remote selections and ghosts use the receiving camera, have no editing handles
and ignore pointer events. Committed shape components retain their identity.
The core, shared browser input and ordinary Solid surface have no awareness hooks
or imports. Non-collaborative hosts keep their existing imports and behavior.

Cursor and preview publication uses a 40 ms trailing debounce with a 100 ms maximum
wait, so continuous movement still sends updates. Capture and encoding happen only
when sending. Selection changes, cursor departure, release and cancellation flush
immediately. The in-memory test transport coalesces the latest packet per peer and
can add artificial latency. Presence is excluded from the durable queued/delivered counters. Disconnect hides remote
presence and discards pending presence packets; reconnect publishes fresh state.
Sync now while offline exchanges only document updates. Monotonic packet sequences
reject duplicate/reordered presence. Heartbeats refresh idle selections every 10
seconds; states expire after 30 seconds without an update, checked on Loro's
15-second cleanup interval. Reset/unmount disposes listeners and timers.

Ghosts are displayed only when their captured document clock matches the receiver's
clock. A commit therefore suppresses a delayed, obsolete gesture until fresh
presence arrives. Selection IDs still resolve against the current committed scene.
The current ghost contract carries rectangle/ellipse dimensions and pencil samples,
using default renderers. It does not carry complete text, connector, media or document
geometry; do not assume every registered shape can render a valid ghost. A full
Canvas Next peer lab needs typed preview coverage or deliberate bounds-only previews
for these kinds, plus connector endpoint-draft awareness. Authenticated peer identity,
payload validation and real network presence transport remain integration work.

The cursor is a colored pointer with a rounded name-only badge, shown only while
the peer's cursor is on the canvas. Pending ghosts replace redundant transform
selection outlines. The receiver springs cursor, ghost geometry and marquee bounds
between packets using one animation loop, with no writes back to presence. The
critically damped closed-form solver stays stable after background tab pauses;
affine transforms interpolate translation, angle, scale and shear separately,
unwrapping angles across ±π instead of interpolating raw matrix entries. New
elements appear at their first reported position. Completion, cancellation,
invalid document clocks and peer removal clear ghosts immediately. Reduced-motion
preferences bypass interpolation; settled/unmounted overlays stop their frame loop.

Tests cover independent and conflicting property edits/undo, concurrent inserts and
ordering, grouping/ungrouping, opposite reparents, parent/pose mismatch, group deletion
versus extraction, remote preview cancellation, delayed/offline transport, duplicates
and reversed deliveries. Node tests use Loro's Node WASM entry; the web app uses the
existing Vite WASM configuration and browser entry.

Awareness tests cover nested and drawing previews, camera mapping, selection and
cursor isolation from document/history, unchanged committed DOM mounts, stale
previews, reordered packets, coalescing, offline/reconnect behavior and disposal/expiry.
Motion tests cover bounded debounce, mid-flight retargeting, shortest-arc rotation,
stable ghost DOM, settling, reduced motion and animation cleanup.

Production integration still needs an accepted geometry/history conflict policy,
an explicit choice to retain cancellation or implement intent rebasing, mixed-content
editor validation, shared collaboration runtime integration, durable initialization,
permissions, reconnect/storage tests and deployment. Asset/text mappings now exist;
their production acceptance is separate from basic mapping tests. This transport is
only an in-memory test harness; do not turn it into another production sync engine.

References: [Loro ordered trees](https://www.loro.dev/docs/tutorial/tree),
[Loro undo](https://www.loro.dev/docs/advanced/undo),
[Loro ephemeral state](https://www.loro.dev/docs/tutorial/ephemeral). See tests for the actual behavior
of the pinned workspace version rather than treating these docs as test evidence.

### Pencil mapping

Pencil geometry travels as one immutable sample-array value in the existing pose
merge unit; transform and geometry still win together. Live drawing is ephemeral
awareness only, with the finalized stroke committed once. The adapter validates
kind/geometry pairs through the core shape registry. As with other poses, moving
a stroke currently resends its geometry; compact encoding and reducing those
payloads are future transport optimizations, not core document requirements.

### Text and embedded items

Text items and shape labels store the exact host-defined content string as one
`textContent` LoroMap value. Concurrent edits select one complete string through
last-write-wins; no LoroText, per-node CRDT, or character merging is involved.
The text register is separate from pose and appearance; label layout is also
separate, so a move cannot discard a new label. Typing drafts remain local and
finished edits become one backend transaction. Tests cover conflicting strings,
text-versus-move, new labels versus moves, and local undo preserving remote moves.

Image, video and document references use the existing shape geometry mapping.
Their source bytes, resolved URLs, loading state and playback are host concerns.

### Next integration gates

Use the actual Canvas view, rich-text measurer and content/asset renderers with two
injected Loro editors. Exercise concurrent whole-string edits, text editing versus
remote movement, local text/scene undo, reference deletion, selection/gesture
awareness and mixed-content layering/focus. Keep embedded document editing under
its own existing permissions/sync; the outer scene shares only the embed reference
and display geometry. No character CRDT, durable seed or second network engine is
needed for this checkpoint.

For the later durable host, reuse the existing collaboration infrastructure and
the [spreadsheet session](../../../../apps/web/src/features/block-spreadsheet/queries/spreadsheet-session.ts)
as a reference for WAL/snapshot recovery and disposal. First audit canvas document
initialization, content routing, authorization and legacy readers; the lab does not
prove that enabling SyncService requires no server changes.
