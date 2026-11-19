-- A saved operation setting made by anything other than a signed-in person
-- (the agent, an API key) only restricts: it takes the stricter of itself and
-- its group's action, so a person's later, stricter group setting still
-- applies. `via_agent` stays the label ("set by the agent"); this is the rule.
-- Both tables are new and unused outside this feature, so the constant
-- default is a catalog-only change and the backfill touches few rows.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_tool_permission
    ADD COLUMN restriction_only boolean NOT NULL DEFAULT false;
UPDATE agent_tool_permission SET restriction_only = true WHERE via_agent;
ALTER TABLE agent_tool_permission
    ADD CONSTRAINT agent_tool_permission_via_agent_restricts
    CHECK (NOT via_agent OR restriction_only);

ALTER TABLE persona_tool_permission
    ADD COLUMN restriction_only boolean NOT NULL DEFAULT false;
UPDATE persona_tool_permission SET restriction_only = true WHERE via_agent;
ALTER TABLE persona_tool_permission
    ADD CONSTRAINT persona_tool_permission_via_agent_restricts
    CHECK (NOT via_agent OR restriction_only);
