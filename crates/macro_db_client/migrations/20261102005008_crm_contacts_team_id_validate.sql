-- Scans under SHARE UPDATE EXCLUSIVE: reads and writes continue.
ALTER TABLE crm_contacts VALIDATE CONSTRAINT crm_contacts_team_id_not_null;
