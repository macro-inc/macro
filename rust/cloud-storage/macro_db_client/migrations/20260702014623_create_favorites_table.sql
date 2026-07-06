-- Favorites: a user's personal ordered collection of entities.
CREATE TABLE favorite
(
    user_id     TEXT             NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    entity_type TEXT             NOT NULL,
    entity_id   TEXT             NOT NULL,
    sort_order  DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    -- A favorite is identified by what it points at; one favorite per entity
    -- per user.
    PRIMARY KEY (user_id, entity_type, entity_id)
);

-- Ordered listing per user.
CREATE INDEX favorite_user_sort_idx ON favorite (user_id, sort_order);

-- Reverse lookup: "is this entity favorited?" checks by (entity_type, entity_id).
CREATE INDEX favorite_entity_idx ON favorite (entity_type, entity_id);
