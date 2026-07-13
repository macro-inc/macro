ALTER TABLE crm_contacts
    DROP COLUMN IF EXISTS last_interaction;

ALTER TABLE crm_contacts
    DROP COLUMN IF EXISTS first_interaction;

ALTER TABLE crm_companies
    DROP COLUMN IF EXISTS last_interaction;

ALTER TABLE crm_companies
    DROP COLUMN IF EXISTS first_interaction;
