-- Local edits are durable independently of the latest remote message snapshot.
-- The checkpoint contains the frozen revision and upload receipts for one attempt;
-- later autosaves change desired_content without changing an in-flight attempt.
CREATE TABLE email_mailbox_drafts (
    message_id uuid PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    generation bigint NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    synced_revision bigint NOT NULL DEFAULT 0 CHECK (synced_revision >= 0),
    actor_id text NOT NULL,
    desired_content jsonb NOT NULL,
    base_version text,
    provider_id text,
    remote_snapshot jsonb,
    delete_requested boolean NOT NULL DEFAULT false,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','synced','conflict','unknown','sent','deleted','cancelled','failed')),
    checkpoint jsonb,
    error_code text,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_mailbox_drafts_claim ON email_mailbox_drafts(available_at,message_id)
    WHERE state IN ('pending','running','synced');
CREATE INDEX email_mailbox_drafts_provider ON email_mailbox_drafts(link_id,provider_id)
    WHERE provider_id IS NOT NULL;

-- Explicit removals retain immutable provider identities across interrupted saves.
CREATE TABLE email_mailbox_attachment_removals (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    PRIMARY KEY (message_id,provider_id)
);
