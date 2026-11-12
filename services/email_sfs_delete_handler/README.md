
# Email SFS Delete Handler

This Lambda function executes daily to clean up orphaned static file service (SFS) attachments. It queries the
`email_attachments_sfs` table for records where `attachment_id` is NULL (indicating the attachment is no longer
linked to any email) and publishes delete messages to the SFS delete queue. This triggers the SFS delete worker
to remove the orphaned files from the static file service and clean up the corresponding database records.

The Lambda adapter delegates to the service-local domain in `src/domain/`; the
PostgreSQL and SQS implementations live in `src/outbound/` and are wired by
`src/composition.rs`. The domain preserves sequential sends in query result order.
Query failures are logged and treated as an empty batch; individual queue failures
are logged and processing continues. Both paths return success from the Lambda.
The query has no age filter, explicit ordering, or claim step, so repeated runs
can enqueue the same orphan again until the delete worker removes its row.
