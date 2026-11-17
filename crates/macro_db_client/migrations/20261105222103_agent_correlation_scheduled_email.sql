SET lock_timeout = '5s';

ALTER TABLE email_scheduled_messages ADD COLUMN agent_correlation_id uuid;
