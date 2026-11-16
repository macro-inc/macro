) SELECT id, company_id, team_id, company_name, email, name, hidden,
       first_interaction, last_interaction, created_at, updated_at, viewed_at,
       -- Evaluated for the rows of the page only: the planner defers
       -- subqueries in the select list until after the sort and limit.
       ARRAY(
           SELECT ce.email FROM crm_contact_emails ce
           WHERE ce.contact_id = candidates.id
           ORDER BY ce.email <> LOWER(BTRIM(candidates.email)), ce.created_at, ce.email
       ) AS emails,
       ARRAY(
           SELECT ce.email FROM crm_contact_emails ce
           WHERE ce.contact_id = candidates.id
             AND EXISTS (
                 SELECT 1 FROM crm_domains d
                 WHERE d.team_id = candidates.team_id
                   AND LOWER(d.domain) = split_part(ce.email, '@', 2)
                   AND d.company_id = candidates.company_id
             )
           ORDER BY ce.created_at, ce.email
       ) AS company_domain_emails
FROM candidates WHERE 