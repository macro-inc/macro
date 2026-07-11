CREATE TABLE IF NOT EXISTS foreign_entity
(
    id                     UUID        PRIMARY KEY NOT NULL,
    foreign_entity_id      TEXT        NOT NULL,
    foreign_entity_source  TEXT        NOT NULL,
    metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    stored_for_id          TEXT        NOT NULL,
    stored_for_auth_entity TEXT        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foreign_entity_foreign_entity_id_source
    ON foreign_entity (foreign_entity_id, foreign_entity_source);

CREATE INDEX IF NOT EXISTS idx_foreign_entity_stored_for_id_auth_entity
    ON foreign_entity (stored_for_id, stored_for_auth_entity);
