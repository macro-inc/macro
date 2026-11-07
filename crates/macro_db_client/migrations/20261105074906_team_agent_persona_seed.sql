SET LOCAL lock_timeout = '5s';

-- Nullable for agents provisioned before recovery inputs were persisted.
ALTER TABLE team_agents ADD COLUMN persona_seed JSONB;
