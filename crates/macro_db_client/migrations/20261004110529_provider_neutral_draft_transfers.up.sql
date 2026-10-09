-- Add up migration script here
CREATE TABLE email_draft_transfers (
    id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    source_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    destination_id uuid NOT NULL UNIQUE,
    source_link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    destination_link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    source_thread_id uuid NOT NULL,
    destination_thread_id uuid NOT NULL,
    plan jsonb NOT NULL,
    state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','cleanup','ready','conflict','retained')),
    issue text,
    revision bigint NOT NULL DEFAULT 1,
    lease_id uuid,
    lease_until timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_draft_transfer_committed_source ON email_draft_transfers(source_id) WHERE state <> 'preparing';
CREATE INDEX email_draft_transfer_cleanup ON email_draft_transfers(available_at) WHERE state='cleanup';

CREATE TABLE email_attachment_blobs (
    attachment_id uuid PRIMARY KEY REFERENCES email_attachments(id) ON DELETE CASCADE,
    object_key text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_attachment_blob_object ON email_attachment_blobs(object_key);
