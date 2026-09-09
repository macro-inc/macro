-- CRM lists: curated collections over a team's companies or contacts whose
-- entries carry their own properties (stage, value, owner, ...). One parent
-- type per list. A record may appear in a list more than once, so there is
-- deliberately no unique index on (list_id, parent_id).

CREATE TYPE crm_list_parent_type AS ENUM ('company', 'contact');

CREATE TABLE crm_lists
(
    id          UUID                 PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    team_id     UUID                 NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    name        TEXT                 NOT NULL,
    parent_type crm_list_parent_type NOT NULL,
    -- The seeded Deals list a team gets when the CRM is enabled; cannot be
    -- deleted, and Company's Stage mirrors its entries during the migration.
    builtin     BOOLEAN              NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ          NOT NULL DEFAULT now(),
    UNIQUE (team_id, name)
);

CREATE INDEX crm_lists_team_id_idx ON crm_lists (team_id);

CREATE TABLE crm_list_entries
(
    id         UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    list_id    UUID        NOT NULL REFERENCES crm_lists (id) ON DELETE CASCADE,
    -- crm_companies.id or crm_contacts.id, per the list's parent_type. No
    -- foreign key because the target table depends on the parent type;
    -- orphan cleanup follows the parent's delete path in the CRM service.
    parent_id  UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX crm_list_entries_list_id_idx ON crm_list_entries (list_id);
CREATE INDEX crm_list_entries_parent_id_idx ON crm_list_entries (parent_id);

-- Entries carry properties through the existing property system.
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'CRM_LIST_ENTRY';
