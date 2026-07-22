-- Provenance marker for user-created CRM rows. The depopulate paths
-- treat contacts without crm_contact_sources rows (and companies
-- without contacts) as derived-data orphans and delete them on link
-- teardown; manually created rows have no sources by construction and
-- must survive that cleanup.
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS manually_created BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS manually_created BOOLEAN NOT NULL DEFAULT FALSE;
