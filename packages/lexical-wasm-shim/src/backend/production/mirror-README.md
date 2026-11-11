# Acknowledged record index and lazy node Map

`RecordMirror` indexes exact native record references along one acknowledged
linear lineage. It never edits node contents or creates a second model. The host
must hold unrelated publications until its local scope is admitted/discarded;
version numbers do not identify sibling ancestry.

Call `replace(version, fullNativeSnapshot)` once before exposing a state's
`LazyNodeMap`. A sparse record set does not establish completeness: `count`,
`keys`, `records` and Map construction reject an incomplete initial index.
Subsequent `apply(version, dirtyRecords, removedKeys)` receipts share the full
snapshot's order metadata and update only acknowledged keys. `count(version)` is
constant time. Indexed `get` reads only JS metadata and returns the exact ref.

`keys` and `records` explicitly enumerate when requested. Keys retain native Map
insertion order: updating preserves position; removing/reinserting appends.
Historical full snapshots establish their own exact order and absence barrier,
so an old unseen key cannot leak into a newer complete snapshot. Only explicit
full snapshots may enumerate the entire index during installation.

`release` and `discard` visit changed/waiting keys, not the whole document.
Discard accepts only the active head provisional version and rejects every
nonhead request before mutation. The backend must first discard that same native
scope, then call this mirror; historical collection uses `release`. It never
synthesizes rebased descendants after an acknowledged ancestor is discarded.
Discard also restores changed-key predecessors retained for rollback, including
when the predecessor allocation version was collected. Unchanged latest refs
remain available to subsequent sparse versions. Native capture leases remain the
backend's responsibility; holding a JS wire ref does not implement that lease.
Snapshot-order metadata is shared across sparse versions. The linear head keeps
its count/order basis after every exposed allocation version is collected; the
next sparse receipt does not require a second full snapshot. Released version
reads still reject.

`LazyNodeMap<Node>` extends the real `Map<string, Node>` class. Construction,
`size`, `has` and `keys` do not instantiate nodes. `get` resolves one requested
record through the injected actual producer; values, entries and `forEach`
resolve only explicit iteration results. Mutators throw `TypeError`. The native
state owner keeps the mirrored version alive while exposing the Map; this class
does not allocate native references or own version/capture lifetimes.

The focused cache suite does not initialize a native editor and is not native
compatibility acceptance. Its typed literals use the real generated wire schema,
and its deterministic lifecycle reference uses ordinary JS Maps only in tests.
The complete backend, capture leases and unchanged editor suites remain separate
requirements.

From the package, with read-only access to the coherent production dependency:

```sh
COMPAT_SOURCE_ROOT=/absolute/source-root TMPDIR=/tmp \
  node node_modules/vitest/vitest.mjs run \
  --config src/backend/production/mirror.vitest.config.mts
```

The focused Vite config places its cache under `TMPDIR`; it imports the unchanged
production `values.ts` and generated protocol rather than stubbing them. For an
isolated source slice, TypeScript may use an out-of-tree config extending
`mirror.tsconfig.json` with `rootDirs` containing this directory and the coherent
production directory. This resolves missing dependency source only; it does not
rewrite types, generate wire declarations or suppress diagnostics.
