-- Preserve proven organization-only ETag transitions before a native draft has
-- its first Macro content journal. The ordinary projection watermark stays separate.
CREATE TABLE email_draft_organization_versions (
    message_id UUID PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    versions TEXT[] NOT NULL CHECK(cardinality(versions)>=2)
);
