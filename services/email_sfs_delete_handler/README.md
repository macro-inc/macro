
# Email SFS Delete Handler

This Lambda function executes daily to clean up orphaned static file service (SFS) attachments. It queries the
`email_attachments_sfs` table for records where `attachment_id` is NULL (indicating the attachment is no longer
linked to any email) and publishes delete messages to the SFS delete queue. This triggers the SFS delete worker
to remove the orphaned files from the static file service and clean up the corresponding database records.