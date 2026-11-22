# Reconciliation provider repair

Mailbox-work FK validation completes asynchronously after deploy; normal
deployment requires no operator action. The worker repairs legacy non-Outlook
reconciliation work before validating both work-table provider constraints.
Existing Outlook streams use a metadata-only default.

The [local query-plan and lock evidence](../design/email-provider-repair-query-plans.json)
uses a synthetic ten-million-row queue; it does not certify production latency.

The `email_reconciliation_provider_backfill` singleton named `v1` records phase,
lease, cumulative counts, a scan-complete marker and completion. Its bounded
parent/child cursors survive restarts. Provider-derivation triggers keep both old
and new writers correct while legacy rows remain unvalidated.

Each replica has one dedicated lazy connection while work is pending. Only one
leaseholder advances pages of at most 1,000 parent or child keys. Pages have
10-second statement/idle limits, a one-second lock limit and 250 ms pacing. A
killed page rolls back repair and cursor together; its 180-second lease expires.
The pool closes on completion. Never reset the scan cursor to recover a worker.

Validation starts only after the durable scan-complete marker. Its two
statements each have a 60-second limit and one-second lock limit, outside deploy
and request paths. SHARE UPDATE EXCLUSIVE permits ordinary reads/writes and
conflicts with DDL and autovacuum. NOT VALID constraints still enforce new writes.

## Validation failures and the constraint cap

`validation_failures` records actual failed attempts for retry backoff: 60 s,
120 s and so on up to one hour. Lock, statement, deadlock and serialization
failures retry indefinitely and never consume the cap.

Only definite FK violations (SQLSTATE 23503) increment the separate
`constraint_failures` counter. Eight such violations stop further validation
scans. The worker remains alive and emits an hourly `validation_blocked`
heartbeat without advancing either counter. Stream mismatch metrics count
verified classifications, not distinct bad rows; retries can encounter the same
row. A blocked constraint remains NOT VALID and enforced for new writes; the
application does not assume validation completed.

Spans carry bounded counts, target, phase and the closed remaining state
`unscanned | awaiting_validation | blocked | none`, with no addresses or message
data. Three code-only, non-paging monitors use env-only dimensions:

| Monitor | Signal |
| --- | --- |
| `email-reconciliation-provider-validation-deferred` | Failed attempts during the last two hours. |
| `email-reconciliation-provider-stream-mismatch` | Verified stream-provider mismatch classifications. |
| `email-reconciliation-provider-validation-blocked` | Hourly capped-state heartbeats keep this alarm active. |

A two-hour window can outlast successful recovery. No monitor is deployed by
merging application code.

## Recover after fixing inconsistent rows

Production inspection and changes require explicit incident-owner approval.
Use an approved bounded repair to correct the underlying inconsistency first;
do not disable triggers or run a bulk UPDATE to silence an alarm. Stream and
reconciliation targets are distinguished by `backfill.validation_target`.

Inspect one known link in keyset windows under a short statement timeout. Select
the page before testing the mismatch, so searching for rare inconsistencies stays
bounded. These psql examples return identifiers, cursor keys and a mismatch flag.
Advance using the last inspected row, including windows with no mismatches;
only an empty page ends that link. Check every relevant window before declaring
it clean.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

WITH page AS MATERIALIZED (
    SELECT id, link_id, generation, kind, scope_id, provider
    FROM public.email_sync_streams
    WHERE link_id = :'link_id'::uuid
        AND (generation, kind, scope_id) >
            (:'after_generation'::bigint, :'after_kind', :'after_scope')
    ORDER BY generation, kind, scope_id
    LIMIT 1000
)
SELECT p.id, p.link_id, p.generation, p.kind, p.scope_id,
    p.provider IS DISTINCT FROM l.provider AS mismatch
FROM page p
JOIN public.email_links l ON l.id = :'link_id'::uuid
ORDER BY p.generation, p.kind, p.scope_id;

WITH page AS MATERIALIZED (
    SELECT link_id, generation, provider_id, provider
    FROM public.email_message_reconciliation
    WHERE link_id = :'link_id'::uuid
        AND (generation, provider_id) >
            (:'after_generation'::bigint, :'after_provider_id')
    ORDER BY generation, provider_id
    LIMIT 1000
)
SELECT p.link_id, p.generation, p.provider_id,
    p.provider IS DISTINCT FROM l.provider AS mismatch
FROM page p
JOIN public.email_links l ON l.id = :'link_id'::uuid
ORDER BY p.generation, p.provider_id;

COMMIT;
```

For the first window use generation `-9223372036854775808` and empty text keys.
If the link is unknown, first page `email_links` by its indexed `id`, at most
1,000 identifiers per query. Retain the last inspected key even when a window
contains no mismatches. Do not put inspected identifiers in public incident notes.

After the approved repair, reset only the cap and retry time, preserving cursor,
scan marker and failure history. The following point update is exercised by the
real-Postgres capped-state regression. Run it only in the approved database:

```sql
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

UPDATE public.email_reconciliation_provider_backfill
SET
    constraint_failures = 0,
    available_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE name = 'v1'
    AND phase = 'validating'
    AND constraint_failures >= 8
    AND lease_id IS NULL;

COMMIT;
```

Expect one updated row. If none changed, inspect phase and lease; do not clear
an active lease. A running blocked worker picks up the reset at its next hourly
tick, or a peer may claim it sooner. No restart is required. Confirm `phase =
'complete'`, a non-null completion marker, and `convalidated = true` for both
`email_sync_streams_link_provider_fkey` and
`email_message_reconciliation_link_provider_fkey` in `pg_constraint`.

## Earlier local preview revisions

Previews that applied earlier versions of these unmerged migrations can report
checksum mismatches. Preserve data and volumes; do not edit the SQLx ledger,
reapply existing versions, or reset a mailbox. Replay the complete chain on a
separate owned scratch database. Continuing a preserved preview requires
checking its actual schema and applying only brand-new additive migrations;
record that distinction in evidence. None of this PR's new migration versions
has been applied in production.
