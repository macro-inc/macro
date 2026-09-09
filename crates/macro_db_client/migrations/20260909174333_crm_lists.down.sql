-- The property_entity_type value cannot be removed; Postgres has no
-- DROP VALUE. Rows keyed on it go with the tables.
DELETE FROM entity_properties WHERE entity_type = 'CRM_LIST_ENTRY';
DROP TABLE crm_list_entries;
DROP TABLE crm_lists;
DROP TYPE crm_list_parent_type;
