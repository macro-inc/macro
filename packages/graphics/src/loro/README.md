# Collaborative scene backend

Canvas Next uses this adapter with the shared collaboration runtime and SyncService.
The package itself owns no network or storage: `createLoroGraphicsBackendFromDoc`
binds an externally owned document through `@loro-mirror/core`, observes remote
scene changes and disposes its Mirror/subscription/history. The original snapshot-owning factory
remains useful for standalone hosts and the in-memory test harness.
Host bookkeeping uses `GRAPHICS_METADATA_ORIGIN` and is excluded from scene undo.
The workspace pins Loro 1.16.3.

The root graphics export stays framework/DOM/Loro-free. `GraphicsBackend` is the
small document/history contract; `createGraphicsEditorFromBackend` proposes local
commits and renders backend snapshots. Loro is authoritative. The editor does not
also maintain snapshot undo for these documents. The owner disposes each editor
before its backend. Memory-backed hosts keep their original behavior.

## Representation

- Mirror's `schema.LoroTree` projects native containment and sibling ordering as
  `{ data, children }`. Mirror owns generic tree creation, diffing, moves and deletion. Node data retains the stable
  graphics ID and immutable kind. The surface is the implicit root of the forest.
- `schema.Value` keeps the deployed atomic registers unchanged. Each node has one
  coherent `pose` register: local matrix, geometry, coordinate
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

Canvas keeps coordinate projection and pose conflict handling in the graphics
adapter; Mirror contains no Canvas-specific geometry logic. The host sync manager
uses `mirror: false` because this graphics backend owns the single typed scene
Mirror on the same host-owned document. Existing native snapshots open without
conversion or node replacement.

The Canvas host currently uses this conflict policy. Such a node stays
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
The ghost contract carries rectangle/ellipse dimensions and pencil samples. Text,
connectors, media and document references use bounds-only rectangle previews.
Canvas validates bounded presence payloads at its shared awareness boundary and
resolves names/colors from shared peer metadata. Connector endpoint-draft awareness
is not published; cursor/selection awareness still applies. The standalone packet
transport remains test-only; production uses the shared awareness runtime.

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

Canvas Next now owns durable initialization, permissions, reconnect/storage and
shared-runtime integration. Tests exercise three sessions and rendered surfaces.
Character-level rich text, intent rebasing and production capacity measurement
remain follow-ups; the in-memory harness does not prove deployed transport limits.

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

### Canvas host integration

`apps/web/src/features/block-canvas/queries/canvas-session.ts` owns shared initialization,
local snapshot/WAL recovery, live transport and teardown. The host imports only the
server's winning seed and preserves original JSON/legacy metadata for export.
Presence publication and validation stay in the host; the reusable overlay accepts
a transport-independent `GraphicsPresence` contract. Embedded documents retain
their own existing permissions/sync. The outer scene shares references and geometry.
