SELECT DISTINCT provider_label_id AS "provider_label_id!" FROM email_gmail_pending_label_writes WHERE message_id = $1 AND expires_at > now() ORDER BY provider_label_id
