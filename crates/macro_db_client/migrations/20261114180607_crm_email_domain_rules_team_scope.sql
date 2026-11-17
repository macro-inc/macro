SET LOCAL lock_timeout = '5s';

-- Match both team keys so legacy domain rules use the partial company index
-- without scanning disabled companies belonging to unrelated teams.
CREATE OR REPLACE FUNCTION crm_email_domain_blocked(crm_team UUID, crm_user TEXT, email_domain TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM (
            SELECT domain FROM crm_blocked_domains WHERE team_id = crm_team
            UNION ALL
            SELECT domain FROM crm_personal_email_blocklist
            WHERE team_id = crm_team AND user_id = crm_user
            UNION ALL
            SELECT d.domain FROM crm_domains d
            JOIN crm_companies c ON c.id = d.company_id
            WHERE d.team_id = crm_team AND c.team_id = crm_team AND NOT c.email_sync
        ) blocked
        WHERE lower(email_domain) = lower(blocked.domain)
           OR right(lower(email_domain), length(blocked.domain) + 1) = '.' || lower(blocked.domain)
    )
$$;
