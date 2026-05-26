ALTER TABLE crm_companies
    ADD COLUMN IF NOT EXISTS first_interaction TIMESTAMPTZ;

ALTER TABLE crm_companies
    ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMPTZ;

ALTER TABLE crm_contacts
    ADD COLUMN IF NOT EXISTS first_interaction TIMESTAMPTZ;

ALTER TABLE crm_contacts
    ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMPTZ;

-- Backfill existing rows from `created_at` — the row's first-write
-- time is the best timestamp we have without an expensive aggregation
-- against email_messages. Future populates will LEAST/GREATEST-merge
-- the real message_at values in.
UPDATE crm_companies
    SET first_interaction = created_at
    WHERE first_interaction IS NULL;

UPDATE crm_companies
    SET last_interaction = created_at
    WHERE last_interaction IS NULL;

UPDATE crm_contacts
    SET first_interaction = created_at
    WHERE first_interaction IS NULL;

UPDATE crm_contacts
    SET last_interaction = created_at
    WHERE last_interaction IS NULL;

ALTER TABLE crm_companies
    ALTER COLUMN first_interaction SET NOT NULL;

ALTER TABLE crm_companies
    ALTER COLUMN last_interaction SET NOT NULL;

ALTER TABLE crm_contacts
    ALTER COLUMN first_interaction SET NOT NULL;

ALTER TABLE crm_contacts
    ALTER COLUMN last_interaction SET NOT NULL;
