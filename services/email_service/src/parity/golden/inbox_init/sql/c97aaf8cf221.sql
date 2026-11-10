UPDATE email_links SET needs_reauth = false, last_sync_error_at = NULL, updated_at = NOW() WHERE id = $1 AND needs_reauth = true
