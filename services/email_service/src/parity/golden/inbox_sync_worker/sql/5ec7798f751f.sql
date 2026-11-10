SELECT h.history_id FROM email_links l JOIN email_gmail_histories h ON h.link_id=l.id WHERE l.id=$1 AND l.provider='GMAIL' AND l.is_sync_active AND l.disconnect_requested_at IS NULL FOR UPDATE OF l,h
