SELECT id FROM email_messages WHERE provider_id=$1 AND link_id=$2 FOR UPDATE
