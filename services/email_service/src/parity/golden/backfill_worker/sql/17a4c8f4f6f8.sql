DELETE FROM crm_contacts ct WHERE ct.team_id = $1 AND ct.manually_created = FALSE AND NOT EXISTS ( SELECT 1 FROM crm_contact_sources WHERE contact_id = ct.id )
