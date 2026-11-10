INSERT INTO email_gmail_histories (link_id, history_id, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (link_id) DO UPDATE SET history_id = EXCLUDED.history_id, updated_at = NOW()
