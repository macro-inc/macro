SELECT id, thread_id FROM email_messages WHERE link_id = $1 AND provider_id = $2 LIMIT 1
