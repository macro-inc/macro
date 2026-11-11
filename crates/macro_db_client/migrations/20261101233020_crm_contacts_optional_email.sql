-- Manually created CRM contacts may be added by name alone, so a
-- contact no longer needs an email. Populate-derived contacts always
-- carry one. UNIQUE (company_id, email) treats NULLs as distinct, so a
-- company can hold several email-less contacts. Dropping NOT NULL is
-- metadata-only; bound the lock wait so a busy table fails fast.
SET lock_timeout = '5s';
ALTER TABLE crm_contacts ALTER COLUMN email DROP NOT NULL;
