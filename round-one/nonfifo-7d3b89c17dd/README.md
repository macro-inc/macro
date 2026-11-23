# Non-FIFO mailbox claim measurements

Source: `7d3b89c17dd5b4e2d7f5e61e3f2f6ae9fb41e609` (tree `2bcc0d0f7003a31cac57787711f807d9600877a4`).
[Machine-readable measurements](measurements.json) include production file and
statement hashes at that commit, the claim prelude, method, fixture counts, the
index set, migration times, every case under custom and generic plans, and the
transition runs. SHA256:
`6b45d8a941c70615754a6237cdac4e6c91dfb6aef3c7e638e17baf028bda9b73`.

These are local synthetic PostgreSQL 14.24 measurements, not production
measurements or a real-provider trial. The measured copy differs from this
commit only by one removed doc comment in `claims.rs`; every SQL statement hash
is identical. Migrations 254, 255, 256 and 261 and the provider repair job are
removed at this commit, and the fixture asserts their indexes and table absent.

| Check | Result |
| --- | --- |
| Families | Stream import/poll, live streams, catalog and reconciliation claims. |
| Matrix | 1k / 10k / 100k links; fresh and stale statistics; custom and generic plans; leased, locked, hot, empty, parked-heavy and ineligible-prefix cases. 666 cases. |
| Claim transaction | Within 3,500 buffers fresh / 4,000 stale; at most 128 row locks; no timeouts; 1k→100k growth 1.17–1.33x. |
| Worst at 100k, fresh / stale | Import 2,427 / 2,351; live 3,125 / 3,134; catalog 3,272 / 3,299; reconciliation 3,098 / 3,095 buffers. |
| Claim prelude | Lock and statement timeouts only; no per-provider advisory lock. |
| Migrations 268–278 | 1.3 s at 1k, 1.4–1.6 s at 10k, 4.2–4.4 s at 100k links. |

## Transition exception

One-time transitions run outside the steady-state gate. Each Progress call
parks or relabels at most 64 rows with at most 128 row locks, then the claimer
acquires real work.

| Transition | Result |
| --- | --- |
| Ineligible prefix, 102,000 due rows at 100k links (links flipped to reauth or inactive) | Live: 1,593 Progress calls, 22.7 s, p50 7.3 ms, max 164 ms. Reconciliation: 1,062 calls, 11.9 s, p50 5.5 ms, max 92 ms. |
| 1M legacy reconciliation wrong-label rows | 15,625 Progress calls, 169–184 s, p50 about 6.4 ms, max 137 ms; Gmail claims correct before and after. |
| Stream on a link of another provider | Unsupported corruption, not a legacy state: streams are Outlook-only on main and the provider is derived and immutable. A 100-stream case is parked in two calls and never relabelled. |

Sampled per-call buffers grow during long transitions because each parked or
relabelled row leaves a dead index entry until vacuum. In the 102,000-row
ineligible prefix the sampled calls rose to 3,895 (live) and 3,553
(reconciliation), above the 3,500 fresh gate on the last samples. In the 1M
prefix they rose from about 2,800 to as much as 11,065 (10k-link fixture; 7,916 at 100k). These calls stay bounded at 64
rows and 128 locks; vacuum or state tuning was not added.

## Caveats

No throughput or advisory-hold estimate is claimed: execution time excludes
commit, WAL, round trips, lock waits and harness bookkeeping. These are
database-only measurements. A separate [runtime receipt](runtime.json) now verifies spans exported to Tempo from the actual current-head IMAP/API/worker executables: an acquired claim, one swept row in each parked family, projection post-commit wake and a quiet 180-second IDLE renewal. Its synthetic fixture used SQL setup plus real verify/promotion and sync; older frontend/support services were retained, so this is no current-head browser or real-provider proof. Human playback and real-provider mailbox
verification remain pending. HOLD MERGE; no deployment.

The runtime check observes separate traces; it does not prove claim-to-downstream parent/child linkage. Claim samples have zero maintenance writes: catalog claims and lazy parking/Progress are not runtime-proved here. Their bounded behavior is covered by the database measurements above.
