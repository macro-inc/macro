DELETE FROM crm_contact_sources cs USING crm_contacts ct WHERE cs.contact_id = ct.id AND ct.team_id = $1 AND cs.link_id = $2
