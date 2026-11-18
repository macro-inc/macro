-- no-transaction
-- One company-less contact per address per team; email sync upserts on it.
-- UNIQUE (company_id, email) does not cover rows whose company_id is NULL.
-- Single statement for CONCURRENTLY; see crm_contacts_team_id_idx.
CREATE UNIQUE INDEX CONCURRENTLY crm_contacts_unfiled_email_idx
    ON crm_contacts (team_id, LOWER(email))
    WHERE company_id IS NULL;
