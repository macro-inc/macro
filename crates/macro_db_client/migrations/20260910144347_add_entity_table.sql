CREATE TYPE entity_owner_type AS ENUM ('user', 'bot', 'team');

CREATE TABLE entity (
    id          UUID PRIMARY KEY,
    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('project','document','chat','agent_session','scheduled_action')),
    owner_type  entity_owner_type NOT NULL,
    owner_id    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT entity_owner_id_matches_type CHECK (
        (owner_type = 'user' AND owner_id LIKE 'macro|%')
     OR (owner_type = 'bot'  AND owner_id LIKE 'bot|%')
     OR (owner_type = 'team' AND owner_id ~ '^[0-9a-f-]{36}$')
    )
);

CREATE INDEX entity_owner_idx ON entity (owner_type, owner_id, entity_type) WHERE deleted_at IS NULL;
CREATE INDEX entity_type_idx  ON entity (entity_type, id);
COMMENT ON TABLE entity IS 'One recorded owner per in-scope resource; effective access lives in entity_access.';
