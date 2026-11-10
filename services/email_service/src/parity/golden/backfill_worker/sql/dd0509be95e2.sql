UPDATE email_threads SET has_calendar_attachment = true WHERE id = (SELECT thread_id FROM email_messages WHERE id = $1) AND NOT has_calendar_attachment
