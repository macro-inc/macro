# Pre-existing editor failures

These entries describe exact source-confirmed production failures. They never
change the invariant registry or exempt generated runs. Each native literal runs
all checks and requires exactly its named failure; any additional failure or an
unexpected repair fails the ledger test. A repaired entry must become a normal
strict regression.

## structural-undo-foreign-text (seed 28)

Severity: high. Undo by one collaborator can hide another collaborator's text on
all connected replicas and in the server's visible document. This reproduces in
both the native editor and the shipping TypeScript browser history binding,
including production tag `v2026.11.6.1` at
`1feb36c68dd04f3b44092717467a6b1d2dd2d22a` (web Loro 1.16.3). It is a pre-existing
production failure and does not block port admission. It remains a strict failure
of `undo_reverts_only_own`.

Minimal sequence (literal in `known_failures.rs`):

1. Open two writable tabs on `SimConfig::editor(28)` and run for 1,000 ms.
2. Writer replaces block 0 with a paragraph (`SetBlock` kind 0, offset 12).
3. Run for 1,000 ms, then collaborator types `FOREIGN` at block 0, offset 12.
4. Run for 1,000 ms, writer invokes Undo, then Settle.

Before Undo every invariant passes. After Undo, exactly the ownership invariant
fails with `undo removed another client's operations`; both replicas lose the
visible insertion. The foreign operation spans remain covered by live and
persisted server VVs. The document converges, so convergence alone cannot detect
this failure.

Structural replacement creates another text container. Undo restores the prior
parent/container lineage, leaving the collaborator's operations in history but
outside the visible tree. Immediate Redo on the writer restores the complete
pre-undo JSON, including the foreign text, on both replicas. This does not erase
the historical ownership failure. Recovery after closing, clearing history,
subsequent edits or compaction has not been established; retained VV coverage is
not a promise of user-accessible recovery.

Run the native ledger with:

```sh
cargo test -p sync_sim --test known_failures -- --nocapture
```

The TypeScript comparison uses the actual browser `registerLoroHistory` binding,
Mirror and source editor reconciliation. The headless AI mixed-version adapter
explicitly has no collaborative undo binding and cannot certify this path. No
synthetic binding or AI capability is added for this ledger. Source-bound browser
comparison and recovery captures are recorded in the implementation report.
