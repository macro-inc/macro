## After the deliberate breaks left the suite

The base branch at `b7023c79d8` and main are merged in, and the base suite's later commits are carried over.

- Removed from the pull request: `ledger/breaks/` (74 patches), `ledger/proofs.tsv`, and the checker's requirement that every test names a break. The patches and what each run did under them are kept with the run evidence, outside the repository.
- Kept: `ledger/inventory.tsv`, `ledger/known-defects.tsv`, `ledger/intermittent-defects.tsv`, and the checker holding the tests and a run against them. Known defects still name the builds they show on, because this suite runs on two: with and without `VITE_ENABLE_CHANNEL_LOCAL_SYNC`.
- Taken from the base suite: a video of every person's page when a run records video, a bounded click in UNR-04, and DM-01, DM-02, DM-03 and MEM-03 going on after a reload when their recorded defect shows.
- One whole run on each build, on a stack rebuilt and seeded anew at this head. Local sync off: 129 passed, 35 skipped, nothing unexpected. Local sync on: 163 passed, 1 failed.
- The failure, on: UNR-06, once. "Until I turn it off" in the Mute notifications submenu took Enter and the menu stayed open, so the channel was never muted. Repeated afterwards: 1 of 50 with local sync on, 0 of 30 with it off. Main added an entry to that submenu since the last round; the cause is not established, and the test is not marked.
- Marked defects that showed: ACC-06 and CHN-02 on both builds, MEM-03 on, DM-01, DM-03 and MSG-18 off.
- `ledger/check.ts`: 164 tests, 67 of 84 listed behaviours covered, 10 known defects, 16 intermittent. `just check` passes.

