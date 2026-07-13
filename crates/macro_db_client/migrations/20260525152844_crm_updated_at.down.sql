DROP TRIGGER IF EXISTS crm_contacts_set_updated_at ON crm_contacts;
DROP TRIGGER IF EXISTS crm_companies_set_updated_at ON crm_companies;

DROP FUNCTION IF EXISTS set_crm_updated_at();

ALTER TABLE crm_contacts
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE crm_companies
    DROP COLUMN IF EXISTS updated_at;
