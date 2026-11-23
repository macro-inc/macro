# IMAP connection recovery: database measurements

Source commit: `103f256f98ef2b50e06693856c13fe796eb1f292`; source tree: `000a2fc85e4edfcec2106561f32998f603b34908`.
The adjacent [measurements.json](measurements.json) is privacy reduced and has SHA-256 `5fd537a992dd799c32832b04b506618c09ff39a633d71039c40eba86b1dbf0a2`.
Statement hashes identify the measured SQL; separate hashes pin the final
forward migrations and the historical diagnostic schema.

Recovery claims one due attempt, commits its nonce lease before engine I/O,
and fences activation, deferral and abandonment. A five-minute lease covers
the client's bounded RPC. The application defers transient failures by age
and expires unresolved attempts at 24 hours; completed receipts remain replayable.
These application properties are covered by native tests and source review;
the SQL measurements below do not exercise the engine RPC.

The attempt due index excludes completed receipts using the exact finite CASE
expression. Keyed writes first lock the owned primary-key row, then test the
nonce, lease and completion fences on that tuple. The separate concurrent
`email_sync_streams_imap_retry_max` index covers only IMAP rows with a non-null
provider wait; the activation and resync maximum queries keep their original SQL.

## Method and results

Synthetic PostgreSQL 14 databases, fresh and deliberately stale statistics,
custom and generic plans. Buffers are shared hits plus reads per statement;
they are not a whole recovery cycle, RPC or throughput measurement. Writes
run in transactions rolled back after measurement. All disposable databases
were removed. SQL values and private runtime identifiers are omitted.
All final-candidate attempt-matrix statements stay below 3,500 buffers with
fresh statistics and 4,000 with stale statistics; the one-row claim lock/update
bound is checked. Diagnostic-draft and without-index controls exceed that budget.

- Attempt matrix: 48 cases × two plan modes at 1k, 10k and 100k attempts.
  No statement sequentially scans the attempt table. Keyed lease, deferral
  and abandonment use primary-key probes; their largest final costs are
  31, 29 and 17 buffers. Claiming locks and updates at most one row.
- Empty-index churn after fixture restoration accounts for the 100k custom
  empty claim's 813–817 buffers (generic: eight). Skipping 200 rows locked
  by another session costs 625–628 buffers and still claims one due row.
- An unpublished diagnostic draft was also measured against the final keyed
  query shapes on identical stale data in 12 cases. The draft reached
  91,566 buffers for a keyed write and 50,222 for a claim; the final shapes
  reached at most 33 and 31 respectively. This is draft SQL comparison,
  not a deployed-service performance comparison.
- Retry-index comparison: 48 cells on 1.03 million streams, including 505,630
  expired waits and 20,200 future waits. The index is valid and contains
  263,179 IMAP wait entries. Results match the direct scoped maximum in every
  cell. A stale hot-link scan falls from about 34,000 buffers to 203–206;
  ordinary links read three to five. The hot link has 5,010 streams and the
  ordinary link ten.
- Custom and stale generic maximum plans use a backward index scan and limit;
  fresh generic plans can aggregate a forward index scan. Both constrain the
  link, generation and future-wait range. The roughly 200-buffer hot cases
  include visibility checks for recently moved fixture waits. The attempt
  matrix also has one 1k stale generic retry case at 203 buffers; this remains
  a bounded index read.
- Resync sibling control: 88 cells match an independent Inbox/catalog maximum.
  All 44 with-index cells use the retry index; folder probes follow only the
  zero, one or five future waits, without fanout. Archive-only and folderless
  waits are excluded correctly. Costs are 203–224 buffers on the hot link and
  three to 26 on the ordinary link.
- Nonce fences at every size: two claimants acquire distinct attempts; a third
  gets none. Expired nonces cannot defer, abandon or activate the new lease.
  A held live lease cannot be acquired twice. The reserve recovery floor is
  120 seconds, and a 300-second deferral remains 300 seconds.

## Limits

No production data, real provider, multi-replica throughput or runtime Tempo
trace was measured. Local elapsed times are omitted. This evidence does not
replace the changed-runtime preview proof or the human trial.

**HOLD MERGE; no deploy.**

The final migration path preserves the checksum of the original attempt-table
migration. Three forward migrations add lease fields, concurrently create
`email_imap_connection_attempts_due`, then concurrently remove the old PR-only
pending index. This produces the measured CASE expression under a new index
name. Historical raw plans retain their original index name; all business SQL
is unchanged. Separate final checks migrate a fresh database and upgrade the
2cc source schema to 929 exact migration versions, preserving pending and
completed attempts without a heap rewrite. The renamed index is selected in
all four 100k-row fresh/stale custom/generic checks (34–36 buffers). These checks
do not migrate or reset the retained preview.
