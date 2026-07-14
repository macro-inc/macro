ALTER TABLE crm_companies
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE crm_contacts
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS crm_companies_visible_team_id_idx
    ON crm_companies (team_id)
    WHERE hidden = FALSE;

CREATE INDEX IF NOT EXISTS crm_contacts_visible_company_id_idx
    ON crm_contacts (company_id)
    WHERE hidden = FALSE;
