-- no-transaction
CREATE INDEX CONCURRENTLY crm_email_rule_contacts_source
ON crm_email_rule_contacts(contact_id, team_id, user_id, revision);
