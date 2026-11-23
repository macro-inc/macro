# Reconciliation provider repair

Legacy reconciliation rows may carry the metadata-only Outlook default for a
non-Outlook link. The background job repairs only those rows in bounded keyset
pages; claims retain their authoritative parent-provider check while it runs.
New old-binary inserts derive the correct provider through the trigger.

Each transaction selects at most 1,000 parent or child keys before filtering and
commits repaired rows with its leased cursor. A failed page rolls back both;
another replica resumes after expiry. The worker uses a separate one-connection
pool, ten-second statement and idle limits, a one-second lock limit and 250 ms
between committed pages. Failed pages release their lease with a retry delay;
stale workers cannot advance the cursor. Completion is durable and closes the
pool. There is no runtime DDL, full-table validation or operator completion step.

## Inspect progress

The `email.reconciliation.provider_backfill` span records batches, links/rows
scanned, rows repaired, phase and outcome (`busy`, `progress`, `complete`,
`failed`). It contains no mailbox addresses, message content or inferred total
remaining rows. No validation-specific monitors are retained.

Production access requires explicit approval. On an authorized database, inspect
the singleton read-only; never reset its cursor or repair with an unbounded UPDATE.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT phase, batches, link_rows_scanned, message_rows_scanned, rows_repaired,
    lease_until, available_at, completed_at
FROM email_reconciliation_provider_backfill
WHERE name = 'v1';
COMMIT;
```

## Earlier local preview revisions

None of these unmerged migration versions has been deployed. Removing the earlier
250/253/262 migrations and editing 251/261 makes SQLx reject local databases that
already applied the old set: applied-but-missing versions and changed checksums
are both errors. Full migration requires a fresh database (or an explicitly
approved reset of a disposable local database). Never edit the SQLx ledger to
hide this. Preserve any needed data and volumes; do not reset a kept mailbox.

The preserved preview deliberately retains its data and old ledger. It cannot
claim a full-migration pass on the revised source. Fresh owned scratch databases
provide the full migration and repair proofs. Any separately authorized scoped
schema adaptation of the preserved preview must be recorded as local-only, not
as a successful full SQLx migration or a production rollout rehearsal.
