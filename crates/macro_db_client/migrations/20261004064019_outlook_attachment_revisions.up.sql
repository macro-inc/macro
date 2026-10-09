-- Explicit provider IDs and stable Content-IDs are separate deletion selectors.
CREATE TABLE email_draft_attachment_removals (
    id UUID PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    provider_id TEXT,
    content_id TEXT,
    CHECK (num_nonnulls(provider_id,content_id) = 1),
    UNIQUE (message_id,provider_id),
    UNIQUE (message_id,content_id)
);
-- Removal never destroys bytes that an in-flight revision still references.
CREATE TABLE email_draft_object_cleanup (
    object_key TEXT PRIMARY KEY,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_draft_object_cleanup_due ON email_draft_object_cleanup(available_at);
