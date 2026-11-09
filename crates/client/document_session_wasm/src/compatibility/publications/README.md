# Native publication receipts

`compatTakePublications()` serializes actual core Commit receipts in FIFO order.
Each response contains at most 256 receipts. Remaining receipts stay in the
observer; callers loop until an empty response. This bounds each transfer, not
the observer's total memory or production rate. There is no loss, coalescing or
snapshot substituted for a commit. Each receipt gets one stable retained version,
its own next state, exact tags/selection and a sparse dirty/removed record batch.
Root text and exportJSON/virtual getters are not used.

`CompatCommit.flags = 0` means this metadata drain creates no new Machine effects.
The original causal session call and executor still process their actual output
flags. Dirty records cannot infer that bitmask. Inline admission consumes its own
actual observer receipts in its response; it never duplicates them in this queue.

A pending update rejects a drain before any receipt movement. Begin, currentVersion
and inline admission reject any observer or Host backlog. Admission checks ordering
before consuming the pending update, including before legacy error cleanup. Queued
versions cannot retire, and cold audit snapshots reject queued delivery. Queue
removal follows successful batch/selection construction and serialization.

Initial empty optimistic Seed can emit a real commit on a new owner. During the
initial cold window only, a new actual owner may be adopted when all observed
receipts belong to it and no old-owner or Host backlog exists. Drain those real
receipts until empty, call currentVersion, then obtain one complete snapshot of
that exact current state before exposing JS EditorState. A zero-receipt initial
owner change uses the same version/snapshot fence without a synthetic Commit.
The window closes only after successful snapshot construction; an earlier snapshot
without a currentVersion marker does not close it. The fence checks actual state
identity and empty delivery queues without refreshing inside the snapshot getter.

Any mixed/old-owner receipt or postactivation owner rebuild rejects and preserves
receipts. This slice deliberately does not provide the typed rebuild protocol,
remote hold, rebase or complete initializer. A caller must surface the error and
must not silently replace the model or take a normal full snapshot as recovery.

The content-free `editor.compat.publications.drain` span follows the active native
trace context and records the ephemeral editor ID. Live application trace linkage
is not proven until the production bridge runs.

The negative owner-integrity test supplies another actual core's receipt to the
observer buffer; it fabricates no Commit or successful acknowledgement.

Tests exercise real Session TextFromView against 10,000 paragraphs (20,001 nodes), bounded
256+2 FIFO delivery, exact removed subtrees/tags, cold bootstrap fences, ordering
rejection that preserves pending work, queued-version retention and audit guards.
These native tests do not prove remote publication hold/rebase or full application
compatibility.
