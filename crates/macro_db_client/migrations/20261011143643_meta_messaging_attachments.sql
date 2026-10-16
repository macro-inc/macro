-- Candidates are reserved before document creation. They intentionally have no
-- document FK until materialization; a crashed upload must reuse its own UUID.
CREATE TABLE meta_messaging_attachment (
    connection_id uuid NOT NULL,
    provider_message_id text NOT NULL,
    ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
    document_id uuid NOT NULL UNIQUE,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','stored')),
    lease_id uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id,provider_message_id,ordinal),
    FOREIGN KEY(connection_id,provider_message_id)
        REFERENCES meta_messaging_message(connection_id,provider_message_id) ON DELETE CASCADE
);
CREATE INDEX meta_messaging_pending_effects_idx ON meta_messaging_message(created_at,message_id)
    WHERE event_published_at IS NULL;
ALTER TABLE meta_messaging_message ADD COLUMN effect_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE meta_messaging_message ADD COLUMN published_revision bigint NOT NULL DEFAULT 0;
