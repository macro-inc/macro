-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS import_entity_jira_team_object_key
    ON import_entity (source, team_id, foreign_id)
    WHERE team_id IS NOT NULL AND source = 'jira'
      AND status IN ('importing', 'imported');
