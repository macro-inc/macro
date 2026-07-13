CREATE TABLE IF NOT EXISTS crm_companies
(
    id         UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    team_id    UUID        NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    email_sync BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_companies_team_id_idx
    ON crm_companies (team_id);

CREATE TABLE IF NOT EXISTS crm_domains
(
    id         UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    company_id UUID        NOT NULL REFERENCES crm_companies (id) ON DELETE CASCADE,
    domain     TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, domain)
);

CREATE INDEX IF NOT EXISTS crm_domains_company_id_idx
    ON crm_domains (company_id);

CREATE INDEX IF NOT EXISTS crm_domains_domain_idx
    ON crm_domains (domain);

CREATE TABLE IF NOT EXISTS crm_contacts
(
    id         UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    company_id UUID        NOT NULL REFERENCES crm_companies (id) ON DELETE CASCADE,
    email      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, email)
);

CREATE INDEX IF NOT EXISTS crm_contacts_company_id_idx
    ON crm_contacts (company_id);

CREATE INDEX IF NOT EXISTS crm_contacts_email_idx
    ON crm_contacts (email);
