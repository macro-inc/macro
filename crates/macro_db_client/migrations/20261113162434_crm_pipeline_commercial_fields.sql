-- CRM-owned roles of a pipeline's Outcome and amount/currency columns. The
-- constant default keeps deployed writers working and rewrites nothing.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_pipeline_entities ADD COLUMN commercial_fields JSONB NOT NULL
    DEFAULT '{"outcome": null, "money": []}'::jsonb;
