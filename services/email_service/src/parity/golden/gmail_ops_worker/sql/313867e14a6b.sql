SELECT DISTINCT thread_id FROM email_messages WHERE id = ANY($1) AND link_id = $2 ORDER BY thread_id
