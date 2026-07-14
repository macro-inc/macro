ALTER TABLE crm_companies
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE crm_contacts
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_crm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_companies_set_updated_at ON crm_companies;
CREATE TRIGGER crm_companies_set_updated_at
    BEFORE UPDATE ON crm_companies
    FOR EACH ROW
    EXECUTE FUNCTION set_crm_updated_at();

DROP TRIGGER IF EXISTS crm_contacts_set_updated_at ON crm_contacts;
CREATE TRIGGER crm_contacts_set_updated_at
    BEFORE UPDATE ON crm_contacts
    FOR EACH ROW
    EXECUTE FUNCTION set_crm_updated_at();
