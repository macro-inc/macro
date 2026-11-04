-- Expand the ledger to Jira without rewriting existing rows. The old
-- binaries continue to write exactly the same source/kind pairs.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_entity DROP CONSTRAINT import_entity_source_check;
ALTER TABLE import_entity ADD CONSTRAINT import_entity_source_check
    CHECK (source IN ('linear', 'notion', 'slack', 'jira')) NOT VALID;
ALTER TABLE import_run DROP CONSTRAINT import_run_source_check;
ALTER TABLE import_run ADD CONSTRAINT import_run_source_check
    CHECK (source IN ('linear', 'notion', 'slack', 'jira')) NOT VALID;
ALTER TABLE import_entity DROP CONSTRAINT import_entity_kind_check;
ALTER TABLE import_entity ADD CONSTRAINT import_entity_kind_check CHECK (
    kind IS NULL
    OR (source = 'linear' AND kind IN ('issue', 'project', 'document'))
    OR (source = 'notion' AND kind IN ('page', 'database', 'data_source', 'row'))
    OR (source = 'slack' AND kind = 'channel')
    OR (source = 'jira' AND kind IN ('jira_issue', 'jira_project', 'jira_epic'))
) NOT VALID;
