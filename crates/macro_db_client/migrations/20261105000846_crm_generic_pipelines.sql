-- A generic pipeline tracks no CRM record: its rows are free-form, like a database's.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_pipeline_entities ALTER COLUMN record_type DROP NOT NULL;
