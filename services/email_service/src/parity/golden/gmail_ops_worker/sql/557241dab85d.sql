UPDATE email_messages SET is_read = $1, updated_at = NOW() WHERE id = ANY($2) AND link_id = $3 RETURNING id
