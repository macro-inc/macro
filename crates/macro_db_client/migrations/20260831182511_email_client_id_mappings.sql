-- Client-generated draft/thread identity as lookup aliases, never PKs.
--
-- Offline clients mint ids for drafts (and compose threads) so queued saves
-- replay idempotently. Those ids are untrusted input: they must not become
-- primary keys in the shared email tables (v7 index locality, id-space
-- squatting, create-on-unknown-id). Instead each client id maps to a
-- server-minted row, scoped by the binding inbox. Lookups scope to the
-- caller's accessible links, so identical client ids from different users
-- never interact. The (link_id, client_id) primary key is the idempotency
-- fence for replayed creates; ON DELETE CASCADE makes discard cleanup free.

CREATE TABLE email_draft_client_ids (
    client_id  uuid NOT NULL,
    link_id    uuid NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES email_messages (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, client_id)
);

-- Cascade deletes and reverse lookups arrive by message id.
CREATE INDEX idx_email_draft_client_ids_message_id
    ON email_draft_client_ids (message_id);

CREATE TABLE email_thread_client_ids (
    client_id  uuid NOT NULL,
    link_id    uuid NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    thread_id  uuid NOT NULL REFERENCES email_threads (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, client_id)
);

CREATE INDEX idx_email_thread_client_ids_thread_id
    ON email_thread_client_ids (thread_id);
