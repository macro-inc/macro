-- Requirements belong to a pipeline; names and labels remain editable.
CREATE TABLE crm_pipeline_stage_requirements (
    pipeline_id UUID NOT NULL REFERENCES crm_pipeline_entities(id) ON DELETE CASCADE,
    stage_column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES property_options(id) ON DELETE CASCADE,
    required_column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    PRIMARY KEY (pipeline_id, stage_column_id, stage_id, required_column_id),
    CHECK (stage_column_id <> required_column_id)
);
CREATE INDEX ON crm_pipeline_stage_requirements (stage_column_id);
CREATE INDEX ON crm_pipeline_stage_requirements (stage_id);
CREATE INDEX ON crm_pipeline_stage_requirements (required_column_id);
