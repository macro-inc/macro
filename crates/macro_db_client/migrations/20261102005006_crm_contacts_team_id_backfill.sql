-- Fill crm_contacts.team_id from each contact's company. Disabling the
-- updated_at trigger keeps the timestamp listings show and sort by; it blocks
-- writes, not reads, until this migration commits.
SET lock_timeout = '5s';
ALTER TABLE crm_contacts DISABLE TRIGGER crm_contacts_set_updated_at;
UPDATE crm_contacts ct
SET team_id = co.team_id
FROM crm_companies co
WHERE co.id = ct.company_id
  AND ct.team_id IS NULL;
ALTER TABLE crm_contacts ENABLE TRIGGER crm_contacts_set_updated_at;
