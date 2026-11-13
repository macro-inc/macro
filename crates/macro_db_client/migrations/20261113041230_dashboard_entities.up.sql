-- A dashboard is a saved dynamic-UI view with its own grants. Every save is a
-- new version; the entity row points at the current one.
-- The foreign keys to "User" lock it briefly; don't queue behind a long query.
SET LOCAL lock_timeout = '5s';

CREATE TABLE dashboard_entities (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    title TEXT,
    current_version INTEGER NOT NULL CHECK (current_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_entities_user ON dashboard_entities (user_id, updated_at DESC);

-- The view as each save left it, decoded and checked before it was written.
-- The author may be anyone with edit access; their account going away keeps
-- the history, so it is not a foreign key.
CREATE TABLE dashboard_versions (
    dashboard_id UUID NOT NULL REFERENCES dashboard_entities(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    view JSONB NOT NULL,
    author_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dashboard_id, version)
);

-- The one dashboard an account shows as its own: an agent account's home.
CREATE TABLE dashboard_homes (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    dashboard_id UUID NOT NULL REFERENCES dashboard_entities(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_homes_dashboard ON dashboard_homes (dashboard_id);

-- entity_access has no foreign key to this table.
CREATE FUNCTION clean_up_dashboard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM entity_access WHERE entity_id = OLD.id AND entity_type = 'dashboard';
    RETURN NULL;
END $$;
CREATE TRIGGER dashboard_cleanup AFTER DELETE ON dashboard_entities
FOR EACH ROW EXECUTE FUNCTION clean_up_dashboard();
