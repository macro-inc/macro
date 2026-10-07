-- Preserve pipeline content as ordinary database app entities on rollback.
INSERT INTO database_entities (database_id, name, user_id, created_at, updated_at, trashed_at)
SELECT database_id, name, user_id, created_at, updated_at, trashed_at FROM crm_pipeline_entities
ON CONFLICT DO NOTHING;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT p.database_id, 'database', ea.source_id, ea.source_type, ea.access_level
FROM crm_pipeline_entities p JOIN entity_access ea ON ea.entity_id = p.id AND ea.entity_type = 'crm_pipeline'
ON CONFLICT DO NOTHING;
DELETE FROM entity_access WHERE entity_type = 'crm_pipeline' AND entity_id IN (SELECT id FROM crm_pipeline_entities);
DROP TRIGGER crm_pipeline_cleanup ON crm_pipeline_entities;
DELETE FROM database_column_protections WHERE column_id IN (SELECT primary_column_id FROM crm_pipeline_entities);
DROP TABLE crm_pipeline_entities;
DROP FUNCTION clean_up_crm_pipeline();
