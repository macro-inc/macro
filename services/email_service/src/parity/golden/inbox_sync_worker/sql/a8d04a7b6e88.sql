SELECT id, provider_id as "provider_id!" FROM email_threads WHERE link_id = $1 AND provider_id = ANY($2)
