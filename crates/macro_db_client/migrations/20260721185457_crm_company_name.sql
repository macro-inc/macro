-- Team-scoped display-name override for manually created CRM companies.
-- NULL means "resolve from crm_domain_directory" (the pre-existing
-- behavior for backfill-created companies); reads COALESCE this column
-- over the directory name. A `name` column existed originally and was
-- dropped in 20260521120000_crm_domain_directory; this one is named
-- custom_name to make the override semantics explicit — user-typed
-- names must stay scoped to the owning team and cannot live in the
-- global directory.
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS custom_name TEXT;
