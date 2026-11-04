# Gmail backfill progress cutover and legacy recovery

PR #8808 replaces delivery counters with durable, unique thread receipts and
saved listing pages. Deploying it does **not** repair legacy jobs. Their Redis
counters cannot prove which deliveries completed their follow-up effects, even
when the corresponding emails are stored. Active legacy operations defer for
15 minutes at a time until explicitly replaced. No customer inventory belongs in
this runbook; keep incident evidence in the existing private recovery document.

## Deployment order (requires separate operational approval)

1. Keep DLQ and expired-message replay held. Record the existing image revisions,
   worker settings, and active legacy job inventory in the private incident record.
2. Quiesce **all** backfill consumers and initialization/outbox publishers, including
   API processes that create/initialize jobs. Let in-flight handlers finish and
   verify no old consumer can restart. Live email work may continue only where it
   cannot consume or initialize backfill work.
3. Apply `20261025185945_email_backfill_progress_in_postgres.sql` and
   `20261104001618_email_backfill_recovery_links.sql` through the normal reviewed
   migration deployment. All are additive. Inspect migration history first; the
   earlier unmerged version of the progress migration had a different checksum and
   must not be overwritten on any environment where someone applied it manually.
4. Replace every backfill-capable binary before resuming any consumer/publisher.
   This is a coordinated cutover, **not a mixed-version rolling deployment**.
   Old workers cannot honor durable thread identities; a Redis fence can expire or
   disappear, so it is not a rollout guarantee.
5. Resume new workers at the approved load/concurrency settings. New jobs use
   Postgres; active legacy jobs defer without consuming their SQS receive budget.
   Monitor `BackfillProgressNeedsRecovery`, job progress, pending completion outbox
   effects, queue age, Gmail throttling, and database load. Do not raise concurrency
   or replay old queues as a side effect of this deployment.

Rollback requires quiescing backfill again. Do not run old consumers against
new durable jobs or republish their work to old binaries. Leave the additive
schema in place. Restoring old binaries while keeping backfill paused is safe;
resuming them requires a separate, reviewed data plan.

## Explicit legacy replacement

Use the `recover_backfill_progress` binary built from this release. It does not
send, receive, delete, or replay queue messages. `DATABASE_URL` must target the
approved primary; never print it or use the private-subnet readonly endpoint.
The command refuses durable jobs, deleted or deleting links, and terminal jobs without a
previously recorded replacement. It locks the selected job and link, atomically
cancels that job, and creates one `is_recovery` job. Concurrent/repeated calls
return the same replacement through `recovery_of`.

Prepare one selected job for review:

```sh
recover_backfill_progress --job-id "$LEGACY_JOB_ID"
```

After approval for that specific recovery, run in a private directory:

```sh
umask 077
recover_backfill_progress --job-id "$LEGACY_JOB_ID" --apply --output recovery-init.json
jq -e '.backfillOperation.init.job_id and .backfillOperation.init.link_id' recovery-init.json
```

Review the resulting job mapping and queue body. With **separate authorization to
send**, enqueue this one Init operation to the approved main backfill queue:

```sh
aws sqs send-message --queue-url "$BACKFILL_QUEUE_URL" --message-body file://recovery-init.json
```

If the send fails or its response is ambiguous, rerun `--apply` for the same old
job to reproduce the same body and resend it. Initialization leases and outboxes
make repeated Init delivery safe. The replacement remains visible as `Init`
until publication succeeds; the tool does not claim that creating it completed
recovery. Replacing an active legacy job is deliberately a full provider sweep,
including emails stored before the incident, and can generate significant load.
Recover bounded batches under the monitoring agent's control.

The sweep reads whole conversations, inserts only missing messages, and reruns
CRM/invitation effects for stored messages. Its canonical import receipt commits
with those message writes; concurrent deliveries cannot add a later snapshot
after metadata completes. Retried imports resume attachment and metadata effects
from that receipt without fetching another provider snapshot. It preserves their existing labels,
schedules thread attachments, and requires metadata completion before recording
one unique thread receipt. The completion outbox retains mailbox-level contacts
and attachment work. Invitation extraction keeps its existing best-effort policy.
A new full sweep recovers currently available provider content; it cannot recreate
content Gmail has since deleted. Review that limitation against private archived
payloads before retiring historical recovery evidence.

For archived imports no longer returned by Gmail, separately verify any stored
thread's metadata, contacts, and attachment scheduling. Completion of the replacement
only proves its newly listed work completed; it does not certify those historical
effects. Keep such entries in the private repair inventory until their remaining
effects have a reviewed repair, rather than marking the old job complete.

Old cancelled imports/listing continuations are safely ignored when delivered.
Do not rewrite their job IDs to the replacement: it owns its own listing and
thread identities. Do not infer that the old messages have been replayed or
removed. Leave live-link finalizers to their existing completion-outbox handler;
deleted-link/cancelled finalizers retire their effects there. User-scoped CRM work
is separate. DLQ replay and recovered expired payloads remain separate approved
operations, with their original checksums and bodies retained privately.

## Verification

For each replacement, verify its Init publication, durable listing completion,
`completed_threads = listed_threads`, terminal `Complete` status, and a completed
completion-outbox row. Check missing metadata, CRM and attachment outcomes using
bounded private probes. A stored message or an empty queue alone is insufficient.

Confirmed provider-deleted threads receive an explicit, deduplicated skip receipt;
an already-imported snapshot still finishes its effects. Other permanent
thread/metadata failures fail the job instead of silently
counting lost effects as success; inspect the cause before another recovery plan.
Malformed individual messages still use the existing savepoint/skip policy.
Keep durable thread receipts and listing pages until their parent job is deleted;
job deletion cascades them. Never delete them to repair a counter.
