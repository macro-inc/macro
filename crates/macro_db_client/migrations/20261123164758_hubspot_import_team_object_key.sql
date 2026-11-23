-- no-transaction
-- One Macro copy per team for each HubSpot object, as for Jira. No HubSpot
-- rows exist yet, so the build cannot conflict. If the build is interrupted,
-- drop the INVALID index before re-running: IF NOT EXISTS would keep it, and
-- the next migration refuses to finish until it is valid.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS import_entity_hubspot_team_object_key
    ON import_entity (source, team_id, foreign_id)
    WHERE team_id IS NOT NULL AND source = 'hubspot'
      AND status IN ('importing', 'imported');
