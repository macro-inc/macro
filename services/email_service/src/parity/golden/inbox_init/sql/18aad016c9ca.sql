UPDATE email_links SET macro_id = $1, email_address = $2, updated_at = NOW() WHERE id = $3
