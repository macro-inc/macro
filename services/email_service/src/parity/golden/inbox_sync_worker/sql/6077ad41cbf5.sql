SELECT id, email_address FROM email_contacts WHERE link_id = $1 AND email_address = ANY($2)
