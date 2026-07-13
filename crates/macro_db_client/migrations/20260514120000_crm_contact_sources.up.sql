CREATE TABLE IF NOT EXISTS crm_contact_sources
(
    id         UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    contact_id UUID        NOT NULL REFERENCES crm_contacts (id) ON DELETE CASCADE,
    link_id    UUID        NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contact_id, link_id)
);

CREATE INDEX IF NOT EXISTS crm_contact_sources_contact_id_idx
    ON crm_contact_sources (contact_id);

CREATE INDEX IF NOT EXISTS crm_contact_sources_link_id_idx
    ON crm_contact_sources (link_id);
