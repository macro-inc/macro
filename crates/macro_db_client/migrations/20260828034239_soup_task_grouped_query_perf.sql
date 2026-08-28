-- Speed up task-only grouped soup queries.
--
-- Task views compile to a document filter on sub_type = 'task' with other
-- entity arms excluded via impossible id filters. The grouped TopItems arm
-- probes document_sub_type for every accessible document; this partial index
-- lets PostgreSQL resolve task membership by index instead of heap filtering.
CREATE INDEX IF NOT EXISTS idx_document_sub_type_task_document_id
ON document_sub_type (document_id)
WHERE sub_type = 'task';

-- Grouped property buckets join entity_properties by definition id, canonical
-- entity type, and entity id (see soup group_join_clause). The existing
-- unique (entity_id, entity_type, property_definition_id) index leads with
-- entity_id; this definition-first index matches the constant property id used
-- by Stage/Priority/Assignee grouping on task lists.
CREATE INDEX IF NOT EXISTS idx_entity_properties_def_type_entity
ON entity_properties (property_definition_id, entity_type, entity_id);
