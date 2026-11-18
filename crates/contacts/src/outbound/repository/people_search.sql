-- Ranked people search over the viewer's contact graph (both directions),
-- self, and the viewer's current team. Peers are read through
-- contacts_connections_user1_user2_key and idx_contacts_connections_user2_user1,
-- so nothing outside the viewer's own edges and team is ever read.
-- $1 viewer id, $2 trimmed query (at least two characters), $3 result limit.
WITH viewer AS MATERIALIZED (
    SELECT $1::text AS id, lower($2::text) AS needle
),
candidates AS MATERIALIZED (
    SELECT directory.id, bool_or(directory.is_teammate) AS is_teammate
    FROM (
        -- Fold case like the scoped peer indexes, then return to the default
        -- collation so the joins below can use "User" and email_contacts keys.
        SELECT lower(user2 COLLATE "C") COLLATE "default" AS id, FALSE AS is_teammate
        FROM contacts_connections
        WHERE user1 = (SELECT id FROM viewer)
          AND user2 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT lower(user1 COLLATE "C") COLLATE "default", FALSE
        FROM contacts_connections
        WHERE user2 = (SELECT id FROM viewer)
          AND user1 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT lower((SELECT id FROM viewer) COLLATE "C") COLLATE "default", FALSE
        UNION ALL
        -- A user has at most one team; its members include the viewer.
        SELECT lower(teammate.user_id COLLATE "C") COLLATE "default", TRUE
        FROM team_user AS own
        JOIN team_user AS teammate ON teammate.team_id = own.team_id
        WHERE own.user_id = (SELECT id FROM viewer)
    ) AS directory
    GROUP BY directory.id
),
profiles AS (
    SELECT
        c.id,
        c.is_teammate,
        COALESCE(u."isAgent", FALSE) AS is_agent,
        substr(c.id, length('macro|') + 1) AS email,
        NULLIF(mui.first_name, 'N/A') AS first_name,
        NULLIF(mui.last_name, 'N/A') AS last_name,
        lower(concat_ws(' ',
            NULLIF(NULLIF(mui.first_name, 'N/A'), ''),
            NULLIF(NULLIF(mui.last_name, 'N/A'), '')
        )) AS full_name
    FROM candidates AS c
    LEFT JOIN "User" AS u ON u.id = c.id
    LEFT JOIN macro_user_info AS mui ON mui.macro_user_id = u.macro_user_id
),
ranked AS (
    SELECT
        p.*,
        (
            starts_with(p.full_name, (SELECT needle FROM viewer))
            OR starts_with(lower(COALESCE(p.last_name, '')), (SELECT needle FROM viewer))
            OR starts_with(p.email, (SELECT needle FROM viewer))
        ) AS is_prefix,
        COALESCE(NULLIF(p.full_name, ''), p.email) COLLATE "C" AS sort_key
    FROM profiles AS p
    WHERE strpos(p.email, (SELECT needle FROM viewer)) > 0
       OR strpos(p.full_name, (SELECT needle FROM viewer)) > 0
    -- Byte order keeps ties stable whatever the database's locale.
    ORDER BY p.is_teammate DESC, is_prefix DESC, sort_key, p.id COLLATE "C"
    LIMIT $3
)
-- Same precedence as the directory's names: a Macro profile name wins;
-- otherwise the viewer's own address-book label, read only for the page.
SELECT
    r.id AS "user_id!",
    r.is_teammate AS "is_teammate!",
    r.is_agent AS "is_agent!",
    CASE
        WHEN r.first_name IS NOT NULL OR r.last_name IS NOT NULL THEN r.first_name
        ELSE split_part(book.name, ' ', 1)
    END AS "first_name?",
    CASE
        WHEN r.first_name IS NOT NULL OR r.last_name IS NOT NULL THEN r.last_name
        WHEN position(' ' IN book.name) > 0
        THEN NULLIF(trim(substring(book.name FROM position(' ' IN book.name) + 1)), '')
    END AS "last_name?"
FROM ranked AS r
LEFT JOIN LATERAL (
    SELECT ec.name
    FROM email_links AS li
    JOIN email_contacts AS ec
        ON ec.link_id = li.id
        AND ec.email_address = r.email
        AND ec.name IS NOT NULL
    WHERE li.macro_id = $1
      AND r.first_name IS NULL
      AND r.last_name IS NULL
    LIMIT 1
) AS book ON TRUE
ORDER BY r.is_teammate DESC, r.is_prefix DESC, r.sort_key, r.id COLLATE "C"
