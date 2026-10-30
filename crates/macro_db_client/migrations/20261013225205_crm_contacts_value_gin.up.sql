-- no-transaction
-- The Contacts counterpart of idx_ep_companies_value_gin: CRM associated-item
-- queries match entities whose Contacts property references a contact. Must
-- stay a single statement (see the Companies migration). IF NOT EXISTS does
-- not repair an INVALID index from an interrupted build; drop it concurrently
-- before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ep_contacts_value_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE property_definition_id = '00000001-0000-0000-0000-000000000013';
