-- Add migration script here
-- Optional for older writers and historical rows during rolling deployment.
SET LOCAL lock_timeout = '5s';
ALTER TABLE activity_events ADD COLUMN agent_verb text;
