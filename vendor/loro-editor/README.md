# Editor Loro internal source

This is the crates.io loro-internal 1.17.1 distribution from upstream revision
`ef83c083f19aea0d590a46db2d541b3a5daf1339`. Public Loro and the TS peer stay 1.17.1;
this changes neither the release pin nor the encoder/format.

Registry archive SHA-256: `7e533c1688430aa4fcdd933f00861e331c169a4158ee6d27d054e0558892d447`.
The MIT license is retained from that exact upstream revision. Upstream agent
guidance is retained as UPSTREAM-AGENTS.md. Optional author metadata, registry
cache markers, standalone lockfiles and the redundant unnormalized manifest are
omitted. Trailing whitespace is trimmed in Encoding.md. The exact upstream dev-utils helper is restored as a development-only
dependency for standalone tracker tests; it is absent from production dependency trees.

Local runtime change: assign each dense text-tracker update range through a
checked slice fill instead of repeated checked SmallVec indexing. LeafIndex is
Copy; input order, bounds/debug checks and resulting leaf assignment remain the
same, including overlapping and empty ranges. Encoder/serializer code and corpus
expectations are untouched. The preserved 1.16.2 server copy uses the same change.

Validate ordered range updates against the existing sequential update algorithm,
consumer tests, exact replay, and a fresh Worker re-record with 155 zero normalized
differences. Keep this path dependency outside workspace membership.

Local event ownership change: move already-owned InternalDocDiff buffers into
the recorder instead of cloning their MapDelta maps a second time. Borrowed
events still become independent owned copies; ordering, undo, remote consumers
and encoder bytes retain their existing semantics. Validate the owned/borrowed
event unit tests and projection/session differential suites.

Eligible editor-owned local commits can suspend event recording at the final
commit boundary. Their undo manager checkpoints the new local op span and its
container ids, preserving remote group conflicts without constructing duplicate
document diffs. Pending event queues, paused/excluded edits, fixups, imports and
undo/redo retain ordinary event delivery. Suppression is opt-in and recording
resumes at the committed frontiers even on native unwinding.

Local undo patch (`src/undo.rs`): skip the group-disjoint container scan when
the remote diff map is empty; retain the same merge and remote-conflict rules.
Upstream rationale: an empty remote row cannot conflict, so local undo pushes need no scan of the group.

Full tracker rebuilds share a lazily built causal operation index for one diff.
The index preserves sliced operation order and derives visitor VVs from the same
persistent DAG contexts; it retains one mutable visitor VV instead of a full
peers-sized map per change. Test-only unindexed replay compares random concurrent
imports/checkouts, complete state/VVs/frontiers/events, and sliced/shallow visits.
The 256-peer resource control bounds retained index payload by history length.
Encoder, version pins, public APIs and wire/corpus expectations remain unchanged.
This patch is maintained for both server1.16.2 and editor1.17.1; upstream branch
preparation is separate and does not authorize publication.

Local child-membership change: liveness queries check ordinary parent membership
without computing a child's sequence rank or cloning its map key. Movable lists
share the same current-value and active-leaf validation with index lookups;
mergeable children still validate their parent marker. No liveness cache,
reachability bypass, operation ordering or encoder change is introduced.
