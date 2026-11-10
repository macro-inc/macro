INSERT INTO email_message_calendar_invites(message_id, component_id, snapshot) VALUES ($1, $2, $3) ON CONFLICT (message_id, component_id) DO NOTHING
