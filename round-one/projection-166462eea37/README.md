# Projection queue measurements

Source: `166462eea3787c54259fe53dbb16cf8b1b73f2b6`.
[Machine-readable measurements](measurements.json) contain source and statement
hashes, methods, synthetic fixture cases, earlier threshold misses and the final
reviewed results. SHA256: `5a105c6d16b5468d793e898824f9d286634588ccb8ac6902c02c8055b80f5321`.

These are owned local PostgreSQL 14 measurements, not production measurements
or a real-provider trial. The PR's other round-one work remains open.

| Check | Result |
| --- | --- |
| 1k / 10k / 100k links; fresh, stale and parked-heavy statistics; custom/generic | Claim within 3,500 buffers on vacuumed / 4,000 on unvacuumed tables; growth <=2x; <=128 row locks; no timeouts. |
| Concurrent finish / late successor insert | Post-commit wake clears the deferral; next claim takes the successor. |
| 20,002-event drain at 100k links, autovacuum off | Exact FIFO; one claim write after initial blocking; two finish writes, last finish one. |
| Parked-link recovery and slow-page handling | Distinct parked-link probes; bounded pages, committed cursor and adaptive retries. |

FIFO is per serialized producer. A crashed or failed post-commit wake relies on
the jittered one-to-two-hour backstop. Dead FIFO index prefixes add about 13
buffers per 1,000 finished events until vacuum; the receipt retains that finding.
A hot inactive backlog needs bounded immediate Progress polls, yielding every 32.
Earlier three-write finish measurements are superseded history in the JSON.

[PR CI](https://github.com/macro-inc/macro/actions/runs/45094172726) passed at this
source on attempt 2 (78 success / 18 skipped). One unchanged channel-directory
timer test failed once and passed the failed-job rerun; tracked as `mac-kjw7`.
No current-head manual browser or new runtime movie is claimed here. Human
playback and real-provider mailbox verification remain pending. HOLD MERGE.
