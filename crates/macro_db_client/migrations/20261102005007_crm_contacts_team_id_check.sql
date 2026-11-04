-- Unvalidated, so adding it takes the exclusive lock only briefly; the next
-- migration validates it without blocking reads or writes.
SET lock_timeout = '5s';
ALTER TABLE crm_contacts
    ADD CONSTRAINT crm_contacts_team_id_not_null CHECK (team_id IS NOT NULL) NOT VALID;
