DELETE FROM crm_companies co WHERE co.team_id = $1 AND co.email_sync = TRUE AND co.manually_created = FALSE AND NOT EXISTS ( SELECT 1 FROM crm_contacts WHERE company_id = co.id )
