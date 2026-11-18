-- The validated check lets SET NOT NULL skip its table scan; the column
-- constraint then replaces the check.
SET lock_timeout = '5s';
ALTER TABLE crm_contacts ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE crm_contacts DROP CONSTRAINT crm_contacts_team_id_not_null;
