-- Ranked people search over the viewer's list-aware directory: their stored
-- lists and inboxes, current team and self. Ranks by list group (teammates;
-- then $5, interacted and invited; then $6, gmail and outlook; then anyone
-- else, the viewer without a team), then name or email prefix, then
-- byte-ordered name or email. Each result carries the viewer's lists for it.
-- $1 viewer, $2 trimmed query (at least two characters), $3 result limit,
-- $4 the teammates list key, $5 and $6 the list keys of the second and third
-- groups.
-- Every candidate is read through the owner-leading primary keys and the
-- team roster, so nothing outside the viewer's own directory is read; each
-- then costs the "User" and macro_user_info probes the legacy search pays.
WITH viewer AS MATERIALIZED (
    SELECT $1::text AS id, lower($2::text) AS needle
),
teammates AS MATERIALIZED (
    -- A user has at most one team, and its roster includes the viewer.
    -- team_user ids may predate canonical lowercase ids; fold them.
    SELECT DISTINCT lower(teammate.user_id COLLATE "C") AS id
    FROM team_user AS own
    JOIN team_user AS teammate ON teammate.team_id = own.team_id
    WHERE own.user_id IN (
        -- team_user may hold a legacy mixed-case id for this user. Find
        -- it through the lower(email) index and keep it only if it folds
        -- to the canonical id.
        SELECT $1::text
        UNION
        SELECT account.id
        FROM "User" AS account
        WHERE lower(account.email) = substr($1, length('macro|') + 1)
          AND lower(account.id COLLATE "C") = $1
    )
      AND teammate.user_id COLLATE "C" LIKE 'macro|%'
),
candidates AS MATERIALIZED (
    SELECT
        -- Return to the default collation so the joins below can use the
        -- "User" and email_contacts keys.
        directory.id COLLATE "default" AS id,
        bool_or(directory.is_teammate) AS is_teammate,
        array_remove(array_agg(DISTINCT directory.list_key), NULL) AS lists
    FROM (
        SELECT contact_user_id AS id, list_key, FALSE AS is_teammate
        FROM contact_list_members
        WHERE user_id = $1
        UNION ALL
        SELECT contact_user_id, list_key, FALSE
        FROM contact_inbox_members
        WHERE user_id = $1
        UNION ALL
        -- The viewer ranks with their team but is never in their own lists.
        SELECT id, CASE WHEN id <> $1::text COLLATE "C" THEN $4::text END, TRUE
        FROM teammates
        UNION ALL
        SELECT $1::text COLLATE "C", NULL, FALSE
    ) AS directory
    GROUP BY directory.id
),
profiles AS (
    SELECT
        c.id,
        c.is_teammate,
        c.lists,
        CASE
            WHEN c.is_teammate THEN 0
            WHEN c.lists && $5::text[] THEN 1
            WHEN c.lists && $6::text[] THEN 2
            ELSE 3
        END AS list_group,
        COALESCE(u."isAgent", FALSE) AS is_agent,
        substr(c.id, length('macro|') + 1) AS email,
        -- Empty profile fields count as missing, so the address-book label
        -- still names the person.
        NULLIF(NULLIF(mui.first_name, 'N/A'), '') AS first_name,
        NULLIF(NULLIF(mui.last_name, 'N/A'), '') AS last_name,
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
    ORDER BY p.list_group, is_prefix DESC, sort_key, p.id COLLATE "C"
    LIMIT $3
)
-- Same precedence as the directory's names: a Macro profile name wins;
-- otherwise the viewer's own address-book label, read only for the page.
SELECT
    r.id AS "user_id!",
    r.is_teammate AS "is_teammate!",
    r.is_agent AS "is_agent!",
    r.lists AS "lists!",
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
ORDER BY r.list_group, r.is_prefix DESC, r.sort_key, r.id COLLATE "C"
