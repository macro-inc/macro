-- Temporary, job-owned reconciliation evidence. Neither messages nor long-lived
-- source mappings depend on this table; job cleanup only removes these intents.
-- One bounded template per first-committed message, not one copy per occurrence.
CREATE TABLE slack_import_message_reference (
    job_id uuid NOT NULL,
    slack_channel_id text NOT NULL,
    message_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    importer_version smallint NOT NULL CHECK (importer_version > 0),
    template jsonb,
    completed_at timestamptz,
    PRIMARY KEY (job_id, message_id),
    FOREIGN KEY (job_id, slack_channel_id)
        REFERENCES slack_import_conversation (job_id, slack_channel_id) ON DELETE CASCADE,
    CHECK ((completed_at IS NULL) = (template IS NOT NULL)),
    CHECK (template IS NULL OR (
        jsonb_typeof(template) = 'object'
        AND octet_length(template::text) <= 4194304
        AND jsonb_typeof(template->'references') = 'array'
        AND jsonb_array_length(template->'references') BETWEEN 1 AND 256
    ))
);

-- Completed rows are small durable checkpoints; large templates are released on
-- settlement and all checkpoints follow the existing job retention/cleanup policy.
CREATE INDEX slack_import_message_reference_pending
    ON slack_import_message_reference (job_id, message_id) WHERE completed_at IS NULL;
