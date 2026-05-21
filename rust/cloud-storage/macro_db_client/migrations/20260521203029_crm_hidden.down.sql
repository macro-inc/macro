DROP INDEX IF EXISTS crm_contacts_visible_company_id_idx;
DROP INDEX IF EXISTS crm_companies_visible_team_id_idx;

ALTER TABLE crm_contacts
    DROP COLUMN IF EXISTS hidden;

ALTER TABLE crm_companies
    DROP COLUMN IF EXISTS hidden;
