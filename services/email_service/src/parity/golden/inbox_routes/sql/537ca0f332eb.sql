SELECT link_id, message_id, send_time, sent, processing, actor_id, agent_correlation_id FROM email_scheduled_messages WHERE message_id = ANY($1) AND sent = false
