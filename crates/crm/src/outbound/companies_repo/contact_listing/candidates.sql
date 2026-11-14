WITH candidates AS (
    SELECT ct.id, ct.company_id, ct.email, ct.name,
           (ct.hidden OR co.hidden IS TRUE) AS hidden,
           ct.first_interaction, ct.last_interaction, ct.created_at, ct.updated_at,
           ct.team_id,
           CASE WHEN co.id IS NOT NULL
                THEN COALESCE(co.custom_name, dd.name, primary_domain.domain, 'Unknown company')
           END AS company_name,
           uh."updatedAt"::timestamptz AS viewed_at,
           ROW_NUMBER() OVER (
               -- Email-less contacts never collapse into each other.
               PARTITION BY COALESCE(LOWER(BTRIM(ct.email)), ct.id::text)
               ORDER BY ct.last_interaction DESC, ct.id DESC
           ) AS email_rank
    FROM crm_contacts ct
    LEFT JOIN crm_companies co ON co.id = ct.company_id
    LEFT JOIN LATERAL (
        SELECT d.domain FROM crm_domains d
        WHERE d.company_id = co.id
        ORDER BY d.created_at, d.id
        LIMIT 1
    ) primary_domain ON TRUE
    LEFT JOIN crm_domain_directory dd ON dd.domain = LOWER(primary_domain.domain)
    LEFT JOIN "UserHistory" uh
        ON uh."itemId" = ct.id::text AND uh."itemType" = 'crm_contact'
       AND uh."userId" =
