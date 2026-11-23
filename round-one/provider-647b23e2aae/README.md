# Provider routing repair measurements

Source: `647b23e2aae57674f8c716cf449807f777c5677a`.
[Machine-readable measurements](measurements.json) include production source and
statement hashes, migration times, statistics provenance, all plans and the
superseded query failure. SHA256:
`3e7474cdd8f3e5f1616f2d90fc839ed2ac04516b3a49416ef9ace58e2e0c1198`.

This is a local synthetic PostgreSQL 14.24 measurement, not production or a
real-provider trial. The provider change removes composite provider constraints,
update cascades and runtime validation. Constant routing defaults, insert-time
provider derivation and the bounded leased legacy reconciliation repair remain.

| Measurement | Result |
| --- | --- |
| Fixture | 10M reconciliation rows, 1M streams, 100,003 parents including 10,000 empty non-Outlook links. |
| Repair | 10M rows in 10,104 committed batches; 416.5 seconds unpaced; largest batch 0.326 seconds. |
| Expected duration with 250 ms pacing | About 49 minutes per 10M legacy non-Outlook rows on this fixture; no production cohort estimate. |
| Parent page | 1,000 parents, about 4,028 buffers and 1.6–4.7 ms; ordered index-only probes; empty parents produce no child pages. |
| Child page | About 990 rows, 30.8–39.3k buffers and 29–101 ms. |
| Statistics | Never analyzed with zero statistics asserted, then explicitly analyzed; custom and generic plans in both states. |
| Migrations | No child heap rewrite; each under one second except the concurrent index over 10M rows at 11.52 seconds. |

The earlier correlated EXISTS query timed out before repair on a skewed queue;
its empty-link probe chose sequential scans. The JSON retains that failure and
the diagnosis disclosure. The ordered LATERAL probe fixes that plan risk.

Local databases that applied removed migrations 250/253/262 or older versions of
251/261 cannot claim a full SQLx migration pass on this source. Preserved local
data and the migration ledger remain intact; full migration proof uses fresh
scratch databases. No hosted data was changed.

The remaining reconciliation claim rewrite must keep live mail running using
the link provider until scan completion and measure the half-repaired queue.
That claim work and the other round-one fixes remain open. Human playback and
real-provider verification are pending. HOLD MERGE; no deployment.
