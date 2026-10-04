-- Independent tickets deliberately do not inherit Task completion or deletion.
CREATE TABLE support_settings (
 team_id UUID PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, widget_key UUID NOT NULL UNIQUE,
 record JSONB NOT NULL, email_cursor_at TIMESTAMPTZ NOT NULL,
 email_cursor_id UUID NOT NULL, last_swept_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
);
CREATE TABLE support_tickets (
 id UUID PRIMARY KEY, team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
 channel_id UUID NOT NULL UNIQUE REFERENCES comms_channels(id),
 email_thread_id UUID, record JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE (id,team_id), UNIQUE (team_id,email_thread_id)
);
CREATE INDEX support_tickets_team_cursor ON support_tickets(team_id,updated_at DESC,id DESC);
CREATE INDEX support_tickets_company ON support_tickets(team_id,(record->'customer'->>'company_id'),updated_at DESC,id DESC);
CREATE INDEX support_tickets_contact ON support_tickets(team_id,(record->'customer'->>'contact_id'),updated_at DESC,id DESC);
CREATE TABLE support_messages (
 id UUID PRIMARY KEY, ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 public BOOLEAN NOT NULL, email_message_id UUID UNIQUE, record JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX support_messages_ticket_cursor ON support_messages(ticket_id,created_at DESC,id DESC);
CREATE TABLE support_task_links (
 ticket_id UUID NOT NULL, team_id UUID NOT NULL,
 task_id TEXT NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
 FOREIGN KEY (ticket_id,team_id) REFERENCES support_tickets(id,team_id) ON DELETE CASCADE,
 PRIMARY KEY(ticket_id,task_id)
);
CREATE INDEX support_task_links_task ON support_task_links(task_id);
CREATE TABLE support_visitor_sessions (
 token_hash BYTEA PRIMARY KEY, ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 origin TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX support_sessions_expiry ON support_visitor_sessions(expires_at);
CREATE TABLE support_agent_jobs (
 ticket_id UUID PRIMARY KEY REFERENCES support_tickets(id) ON DELETE CASCADE,
 trigger_id UUID NOT NULL, due_at TIMESTAMPTZ NOT NULL,
 lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX support_agent_jobs_due ON support_agent_jobs(due_at);
CREATE TABLE support_rate_limits (bucket TEXT PRIMARY KEY,window_at TIMESTAMPTZ NOT NULL,requests INTEGER NOT NULL);
