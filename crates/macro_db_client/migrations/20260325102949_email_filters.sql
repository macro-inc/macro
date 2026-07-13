CREATE TABLE IF NOT EXISTS email_filters
(
    id            UUID                 DEFAULT gen_random_uuid() NOT NULL,
    link_id       UUID        NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    email_address VARCHAR(320),
    email_domain  VARCHAR(255),
    is_important  BOOLEAN     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_filters_pkey PRIMARY KEY (id),
    CONSTRAINT email_filters_address_xor_domain_chk
        CHECK (
            (email_address IS NOT NULL AND trim(email_address) <> '')
            <>
            (email_domain IS NOT NULL AND trim(email_domain) <> '')
        ),
    CONSTRAINT email_filters_email_domain_format_chk
        CHECK (email_domain IS NULL OR (trim(email_domain) <> '' AND position('@' IN email_domain) = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS email_filters_link_id_email_address_uq
    ON email_filters (link_id, lower(email_address))
    WHERE email_address IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_filters_link_id_email_domain_uq
    ON email_filters (link_id, lower(email_domain))
    WHERE email_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_filters_link_id
    ON email_filters (link_id);