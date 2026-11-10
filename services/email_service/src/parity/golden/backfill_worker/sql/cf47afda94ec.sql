SELECT c.id, c.hidden FROM crm_companies c JOIN crm_domains d ON d.company_id = c.id WHERE c.team_id = $1 AND d.team_id = $1 AND LOWER(d.domain) = $2 LIMIT 1
