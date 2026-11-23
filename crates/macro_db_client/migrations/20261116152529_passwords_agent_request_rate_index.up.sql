-- no-transaction
-- New-request rate limit: one agent's requests in a team within the window.
-- Single statement for CONCURRENTLY.
CREATE INDEX CONCURRENTLY password_activity_agent_requests ON password_activity(team_id, agent_user_id, occurred_at)
    WHERE action = 'agent_access_request';
