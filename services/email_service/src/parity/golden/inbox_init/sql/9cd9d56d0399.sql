DELETE FROM in_progress_user_link WHERE id = $1 AND macro_user_id = $2 AND email_provider = 'OUTLOOK' AND linked_email = $3 AND created_at > now() - interval '24 hours'
