SELECT EXISTS ( SELECT 1 FROM crm_blocked_domains WHERE team_id = $1 AND domain = $2 ) AS "blocked!"
