CREATE TABLE IF NOT EXISTS crm_domain_directory
(
    id          UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    domain      TEXT        NOT NULL,
    name        TEXT,
    description TEXT,
    icon_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_domain_directory_domain_key
    ON crm_domain_directory (LOWER(domain));

ALTER TABLE crm_companies DROP COLUMN IF EXISTS name;
