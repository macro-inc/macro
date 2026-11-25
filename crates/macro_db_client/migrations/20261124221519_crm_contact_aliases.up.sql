-- The foreign key locks crm_contacts against writes while it is added.
SET LOCAL lock_timeout = '5s';

-- The id of a contact merged away, and the contact it now names. A later
-- merge re-points these rows to the newer survivor, so a chain is never
-- followed. Deleting the survivor deletes its aliases, so the old ids name
-- nothing again.
CREATE TABLE crm_contact_aliases
(
    retired_id UUID PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES crm_contacts (id) ON DELETE CASCADE,
    merge_id   UUID NOT NULL REFERENCES crm_merges (id) ON DELETE CASCADE,
    CHECK (retired_id <> contact_id)
);

CREATE INDEX crm_contact_aliases_contact_id_idx ON crm_contact_aliases (contact_id);
CREATE INDEX crm_contact_aliases_merge_id_idx ON crm_contact_aliases (merge_id);
