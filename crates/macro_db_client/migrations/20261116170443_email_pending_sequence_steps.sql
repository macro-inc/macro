-- A sequence step that is scheduled but neither sent nor failed. It is not
-- the user's mail yet: mail lists, threads and search leave these messages
-- out by excluding this view's rows, so the rule is defined once.
CREATE VIEW email_pending_sequence_steps AS
SELECT message_id
FROM email_scheduled_messages
WHERE source IS NOT NULL AND NOT sent AND delivery_status <> 'failed';
