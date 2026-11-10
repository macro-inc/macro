UPDATE calendar_accounts SET sync_status = 'disabled', last_sync_error = 'Calendar permission is no longer granted', updated_at = now() WHERE email_link_id = $1 RETURNING id
