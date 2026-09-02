-- Agent-ness is the presence of an agent_configs row (or a SystemBot
-- registry entry), not a flag on bots. The old "Agent Harness" toggle on
-- webhook bots wrote this column without a config; those rows become
-- ordinary webhook bots.
ALTER TABLE bots DROP COLUMN has_agent;
