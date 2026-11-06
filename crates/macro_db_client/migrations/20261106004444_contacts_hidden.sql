-- A person a user has chosen not to see. The contact graph edge can remain
-- (sync recreates it); this row is what keeps them out of suggestions and
-- direct-message creation.
CREATE TABLE contacts_hidden (
    owner_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, contact_id),
    CHECK (owner_id <> contact_id)
);
