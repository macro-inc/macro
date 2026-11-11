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

`RecordMirror` accepts an optional nonthrowing, nonreentrant retention observer:

```ts
interface CaptureRetentionDelta {
  readonly retain: readonly IForeignRecordRef[];
  readonly release: readonly IForeignRecordRef[];
}
new RecordMirror((delta: CaptureRetentionDelta) => bufferLeases(delta));
```

Each nonempty notification describes one completed `apply`, `replace`, `release`
or `discard` transition. The observer only buffers work. Before releasing the
native graph/version, the backend must process **all retains before any releases**
in each batch. Observer failure is outside this contract: the mirror has already
mutated and cannot roll back external lease effects. Reentrant mutation throws.

Ownership counts use exact wire-reference object identity, without reconstructing
or normalizing reference fields. Distinct decoded objects are reported separately,
even if their fields match; the backend owns any native lease aggregation. History
entries and provisional undo entries each own their references. Shared ownership
emits one retain when the first entry arrives and one release when the last entry
leaves. Replacements within one transition are reduced to net changes, so transient
refs and undo-to-history transfers never create lease gaps. Reads and enumeration
emit nothing. Raw node wrappers have independent leases and are not covered by
this observer.

Head and parent metadata contain no record refs; their visible basis records
remain in history or undo after exposed version collection. Per-key pruning checks exact
snapshot visibility, so a historical key hidden by a newer full snapshot releases
its lease when its last reader/rollback basis leaves. Parent-basis waiting indexes
revisit that key when the owning lineage entry is collected. A released allocation
version therefore does not release a carried latest record. Head discard transfers undo
ownership back into history before its lease can leave. Releasing undo and pruning
history visit only changed/waiting keys; ownership bookkeeping visits only refs
touched by that transition. Explicit full snapshot installation remains the only
operation allowed to enumerate the document. Collecting every exposed version
preserves the head basis intentionally; it is not mirror disposal.

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
