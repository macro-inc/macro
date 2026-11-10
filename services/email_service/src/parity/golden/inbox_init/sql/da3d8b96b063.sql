INSERT INTO email_settings (link_id) -- default settings for new links VALUES ($1) ON CONFLICT (link_id) DO NOTHING
