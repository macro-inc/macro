# Derived JS cache producer

`derived-cache.ts` owns only exact-instance JS cells and the prefreeze view
invocation. It imports actual shim node types and generated host request/stage
types. Backend, editor, runtime, handles, admission and native acknowledgement
wiring remain outside this module.

Initialize roots once to the pinned constructor's null value. Rebinding the same
object preserves its existing cell. Initialize element format/style once from
complete acknowledged raw fields; identical repeats are harmless, changed repeats
reject. Weak cells follow the captured JS object, never its key or a latest graph.

Refresh an element projection only through `applyElementProjection`, which calls
the real `assertProjection(node, version, updateId)` authority before changing the
cell. This path is independent of a Reconcile stage. It must reject mutation of
an old/frozen capture. There is no root projection refresh.

`reconcile(request, commit)` accepts the generated Reconcile variant only, requires
its Mutable next version and an actual writable pending state, and requires the
authoritative `removedNodes` delta. The injected `withStage` must validate the real
stage/leases and associate the editor and pending state without a read-only
substitution. Inside that scope it calls the existing view's `reconcile`. The producer passes the adapter's optional `withScope` identity callback so its
read-only default does not shadow the authorized writable frame. The injected
`reconcile` must forward the complete adapter signature, including this scope. The normal
adapter default and every DOM selection probe remain read-only, even in a stage.

Field binding routes actual root/text derived writes through `writeRoot`,
`writeTextFormat` and `writeTextStyle`. Each write checks the active stage through
the real `assertWritable(node, nextVersion, updateId)` capability before mutating
an initialized cell. Root writes accept exact strings, never null. Exceptions
restore the prior active stage. Reads perform weak-cell lookup only: no latest
lookup, native query, traversal or read-only memo write.

The module returns the view's mutation result and never constructs a wire Ack or
serializes a root string. The host owner retains capture leases, buffered native
operations, opaque patches, stage admission, invalidation and final freeze. The
JS cell must be bound to the exact writable capture; an old instance is not a
write target, even when its node key matches.

The value tests use actual node objects and real development-WASM commits. They
cover initialization, capture isolation and malformed metadata only. Positive
projection/stage-write/rollback/freeze and zero-crossing acceptance require the
real generated host hook and capability bindings. No fake callback/editor is used
to claim that acceptance, and this source module does not activate a runtime.
