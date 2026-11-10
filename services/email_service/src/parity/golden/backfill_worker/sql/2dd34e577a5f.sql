SELECT provider_id AS "provider_id!" FROM email_messages WHERE link_id = $1 AND provider_id = ANY($2)
