INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3) ON CONFLICT (team_id, LOWER(domain)) DO NOTHING
