-- CRM pipelines for the source-list equality test, after viewer_matrix.sql:
-- one per grant source and one holding every grant, all in team A. Each
-- pipeline has its own backing database and table.
CREATE TEMPORARY TABLE matrix_pipeline AS
SELECT source_id AS key, source_id, source_type, level FROM matrix_grant_source
UNION ALL
SELECT 'all', NULL, NULL, NULL;
INSERT INTO databases (id) SELECT matrix_item('pipeline-database', key) FROM matrix_pipeline;
INSERT INTO database_tables (id, database_id, name, position)
SELECT matrix_item('pipeline-table', key), matrix_item('pipeline-database', key), 'Pipeline', 'a0'
FROM matrix_pipeline;
INSERT INTO crm_pipeline_entities (id, team_id, database_id, name, user_id, table_id, primary_column_id)
SELECT matrix_item('pipeline', key), '7a000000-0000-0000-0000-00000000000a'::uuid,
       matrix_item('pipeline-database', key), 'Pipeline', 'macro|matrix-owner@example.com',
       matrix_item('pipeline-table', key), matrix_item('pipeline-column', key)
FROM matrix_pipeline;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('pipeline', source_id), 'crm_pipeline', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('pipeline', 'all'), 'crm_pipeline', source_id, source_type, level
FROM matrix_grant_source;
DROP TABLE matrix_pipeline;
