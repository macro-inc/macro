-- Each sort reads the companies this user has viewed from their history, and
-- the rest of the team from an index in the sort's order, stopping after $3
-- rows either way. Branch conditions on parameters alone are checked once per
-- execution, so only the requested sort's branches run, also under a cached
-- generic plan. A single ORDER BY CASE $4 reads and sorts the whole team.
--
-- Viewed companies get their own branch because a generic plan can look up a
-- company's view time by scanning the user's whole history for each company.
-- Only the explicit-ids branch, which reads few companies, looks views up per
-- company.
WITH limited_companies AS (
    SELECT *
    FROM (
        -- Explicit ids are few, so this branch has no index order or limit.
        (
            SELECT
                c.id, c.team_id, c.custom_name, c.email_sync, c.hidden,
                c.first_interaction, c.last_interaction,
                CASE $4
                    WHEN 'created_at' THEN c.first_interaction
                    WHEN 'viewed_at' THEN uh."updatedAt"
                    WHEN 'viewed_updated'
                        THEN COALESCE(uh."updatedAt", c.last_interaction)
                    ELSE c.last_interaction
                END AS sort_ts,
                uh."updatedAt"::timestamptz AS viewed_at
            FROM crm_companies c
            LEFT JOIN "UserHistory" uh
                ON uh."itemId" = c.id::text
               AND uh."itemType" = 'crm_company'
               AND uh."userId" = $8
            WHERE cardinality($2::uuid[]) > 0
              AND c.id = ANY($2::uuid[])
              AND c.team_id = $1
              AND c.hidden = COALESCE($5::bool, FALSE)
        )
        UNION ALL
        -- Companies the user has viewed, under every sort. Bounded by the size
        -- of the user's company history rather than the team.
        (
            SELECT *
            FROM (
                SELECT
                    c.id, c.team_id, c.custom_name, c.email_sync, c.hidden,
                    c.first_interaction, c.last_interaction,
                    CASE $4
                        WHEN 'created_at' THEN c.first_interaction
                        WHEN 'updated_at' THEN c.last_interaction
                        ELSE uh."updatedAt"::timestamptz
                    END AS sort_ts,
                    uh."updatedAt"::timestamptz AS viewed_at
                FROM "UserHistory" uh
                JOIN crm_companies c ON c.id::text = uh."itemId"
                WHERE cardinality($2::uuid[]) = 0
                  AND uh."userId" = $8
                  AND uh."itemType" = 'crm_company'
                  AND c.team_id = $1
                  AND c.hidden = COALESCE($5::bool, FALSE)
            ) viewed
            WHERE $6::timestamptz IS NULL OR (sort_ts, id::text) < ($6, $7)
            ORDER BY sort_ts DESC NULLS LAST, id DESC
            LIMIT $3
        )
        UNION ALL
        -- The remaining branches read unviewed companies. NOT IN rather than
        -- NOT EXISTS: "itemId" is NOT NULL, so they are equivalent, and NOT IN
        -- is planned as one hashed lookup of the user's history instead of a
        -- scan of it per company.
        --
        -- The seek bound repeats the keyset's leading column so the index
        -- scan starts at the cursor. Both interaction columns are NOT NULL,
        -- so it drops no rows; the row comparison stays exact.
        --
        -- Unviewed companies sort by last_interaction under viewed_updated too.
        (
            SELECT
                c.id, c.team_id, c.custom_name, c.email_sync, c.hidden,
                c.first_interaction, c.last_interaction,
                c.last_interaction,
                NULL::timestamptz
            FROM crm_companies c
            WHERE cardinality($2::uuid[]) = 0
              AND $4 IN ('updated_at', 'viewed_updated')
              AND c.team_id = $1
              AND c.hidden = COALESCE($5::bool, FALSE)
              AND c.last_interaction <= COALESCE($6::timestamptz, 'infinity')
              AND ($6::timestamptz IS NULL OR (c.last_interaction, c.id::text) < ($6, $7))
              AND c.id::text NOT IN (
                  SELECT uh."itemId" FROM "UserHistory" uh
                  WHERE uh."userId" = $8
                    AND uh."itemType" = 'crm_company'
              )
            ORDER BY c.last_interaction DESC NULLS LAST, c.id DESC
            LIMIT $3
        )
        UNION ALL
        (
            SELECT
                c.id, c.team_id, c.custom_name, c.email_sync, c.hidden,
                c.first_interaction, c.last_interaction,
                c.first_interaction,
                NULL::timestamptz
            FROM crm_companies c
            WHERE cardinality($2::uuid[]) = 0
              AND $4 = 'created_at'
              AND c.team_id = $1
              AND c.hidden = COALESCE($5::bool, FALSE)
              AND c.first_interaction <= COALESCE($6::timestamptz, 'infinity')
              AND ($6::timestamptz IS NULL OR (c.first_interaction, c.id::text) < ($6, $7))
              AND c.id::text NOT IN (
                  SELECT uh."itemId" FROM "UserHistory" uh
                  WHERE uh."userId" = $8
                    AND uh."itemType" = 'crm_company'
              )
            ORDER BY c.first_interaction DESC NULLS LAST, c.id DESC
            LIMIT $3
        )
        UNION ALL
        -- Unviewed companies sort as NULL under viewed_at. NULL never passes a
        -- cursor, so they only appear on a first page.
        (
            SELECT
                c.id, c.team_id, c.custom_name, c.email_sync, c.hidden,
                c.first_interaction, c.last_interaction,
                NULL::timestamptz,
                NULL::timestamptz
            FROM crm_companies c
            WHERE cardinality($2::uuid[]) = 0
              AND $4 = 'viewed_at'
              AND $6::timestamptz IS NULL
              AND c.team_id = $1
              AND c.hidden = COALESCE($5::bool, FALSE)
              AND c.id::text NOT IN (
                  SELECT uh."itemId" FROM "UserHistory" uh
                  WHERE uh."userId" = $8
                    AND uh."itemType" = 'crm_company'
              )
            ORDER BY c.id DESC
            LIMIT $3
        )
    ) candidates
    WHERE EXISTS (
        SELECT 1 FROM team_crm_settings tcs
        WHERE tcs.team_id = $1 AND tcs.crm_enabled
    )
      -- Keyset seek (NULL = first page): keep only rows that sort strictly
      -- after the cursor.
      AND ($6::timestamptz IS NULL OR (sort_ts, id::text) < ($6, $7))
    ORDER BY sort_ts DESC NULLS LAST, id DESC
    LIMIT $3
)
SELECT
    lc.id                AS "company_id!",
    lc.team_id           AS "company_team_id!",
    lc.email_sync        AS "company_email_sync!",
    lc.hidden            AS "company_hidden!",
    lc.first_interaction AS "company_created_at!",
    lc.last_interaction  AS "company_updated_at!",
    d.id                 AS "domain_id?",
    d.domain             AS "domain?",
    d.created_at         AS "domain_created_at?",
    COALESCE(lc.custom_name, dd.name) AS "display_name?",
    dd.description       AS "dir_description?",
    lc.viewed_at         AS "viewed_at?"
FROM limited_companies lc
LEFT JOIN crm_domains d ON d.company_id = lc.id
LEFT JOIN crm_domain_directory dd
    ON LOWER(dd.domain) = LOWER(d.domain)
ORDER BY
    lc.sort_ts DESC NULLS LAST,
    lc.id DESC,
    d.created_at ASC NULLS LAST
