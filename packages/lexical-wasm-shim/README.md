# Lexical development shim

Private compatibility work over the Rust conformance host. The backend and update
controller run real model transactions, JavaScript transforms and application
commands. The drop-in `lexical` facade and foreign-class adapters are still being
implemented; this package is not a production dependency.

Run from this directory:

```sh
bun install --frozen-lockfile
TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=4 bun run test
bun run check
```

Tests build the fingerprinted optimized web WASM artifact using the shared
conformance build script. Updates batch until the microtask boundary, except
discrete updates and composition ownership changes. Nested update bodies run
before transforms finish; publication precedes update listeners and deferred
callbacks. Listener-enqueued updates begin after that callback phase. Errors
discard pending writes before invoking the error handler. Unchanged updates close
without publishing or leaking tags into later work, while detached API values
remain usable. Disposal cancels queued work and releases the model after any
active callback returns.

The backend owns registered JS callbacks and passes weak forwarding functions into
Rust. This avoids an editor → Rust → callback → editor retention cycle while
keeping callbacks alive as long as their JS editor is reachable. Unreachable
backends release their Rust facades through a finalizer. The lifetime tests force
GC and await that release event; explicit disposal is idempotent.

The production view lives in `lexical-wasm-view`; DOM code belongs there.

Captured-node identity is cached weakly per editor and version. Reachable nodes pin their Rust version; collection waits through active updates and cancels if a new node owner captures the version before publication. Full native node classes, foreign hosting and read scopes remain unfinished.

Foreign class metadata captures native hook implementations before JS patches,
walks registered and native ancestry, and computes inherited override masks in the
model-derived hook order. Prototype writes update masks; a new native-to-JS flip
rejects after the first update. A pre-update recheck also catches descriptor
replacements such as spies. Registry ownership is weak at shared prototypes, and
native non-writable methods and sealed prototypes retain their semantics. This
metadata is an implementation prerequisite; connection to the facade and Rust
foreign-node dispatch is still in progress.

The internal backend can now register foreign node metadata and dispatch mutable text and structural
operations to JS through the current model callback lease. Native
super calls and nested indexed operations use that lease. Other foreign hook bits
and native class overlays still reject explicitly while their adapters are built;
the complete prototype-driven class facade remains unfinished.

Mutable structural overrides (`append`, `splice`, `remove`, `setIndent`, `updateFromJSON`, `resetOnCopyNodeFrom`) share the exact callback scope and native-super path. Node arguments from internal model calls use the shared captured identity encoder. Other foreign hooks and the full facade remain unfinished.

Node-returning overrides (`replace`, `insertAfter`, `insertBefore`, `createParentElementNode`) return captured node handles. The host validates them against the exact update and reuses the normal identity encoder; invalid results fail without losing the callback scope.

Selection-bearing `insertNewAfter` and `collapseAtStart` hooks retain active/detached slot identities. Static `transform` callbacks run in the dirty loop. Optional node results accept null; undefined is invalid. The JS facade still needs to invoke a class transform factory and its returned node function.

The internal `$parseSerializedNode` entry uses the model import algorithm. Static `importJSON` dispatches with a null node receiver and validates the returned captured handle; child imports and virtual append run after the factory. Native-super import construction and the full static-class facade remain unfinished.

Mutable `selectionTransform` hooks receive the existing previous committed and current active selection handles; the pipeline follows focus movement made by the anchor hook. `$getPreviousSelection` and its point handles retain committed ownership through later update rollback. The full class facade and ordinary selection freezing remain unfinished.

The backend also hosts `exportJSON` with scoped reentrant reads, native-super, opaque exceptions and write/effect rejection. The read peer still rejects inherited selection value writes and originless committed captures; the other pure hooks and complete class facade remain unfinished.
