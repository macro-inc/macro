-- no-transaction
-- One Macro copy per team for each Salesforce object, as for HubSpot. No
-- Salesforce rows exist yet, so the build cannot conflict. If the build is
-- interrupted, drop the INVALID index before re-running: IF NOT EXISTS would
-- keep it, and the next migration refuses to finish until it is valid.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS import_entity_salesforce_team_object_key
    ON import_entity (source, team_id, foreign_id)
    WHERE team_id IS NOT NULL AND source = 'salesforce'
      AND status IN ('importing', 'imported');
