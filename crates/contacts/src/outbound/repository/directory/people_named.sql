-- People in the viewer's list-aware directory (their stored lists and
-- inboxes, current team and self) whom the typed text names, as the local
-- people ranking's two name stages decide it: the whole name, or for one word
-- the first name, equals the text; or every typed word starts a word of the
-- name. The name is the one the directory shows: the Macro profile name, else
-- the viewer's own address-book label, else the address's local part. Ranks
-- by list group ($6, interacted and invited; then teammates, the viewer
-- included when on a team; then $7, gmail and outlook; then anyone else),
-- then exact matches, then byte-ordered ids. Each result carries the viewer's
-- lists for it.
-- $1 viewer, $2 normalized text, $3 its distinct words, $4 result limit, $5
-- the teammates list key, $6 and $7 the list keys of the first and third
-- groups.
-- Every candidate is read through the owner-leading primary keys and the
-- team roster; each then costs the "User" and macro_user_info probes the
-- ranked search pays. The viewer's address book is read once and hash-joined
-- to the people without a profile name.
WITH patterns AS MATERIALIZED (
    -- Words hold only letters and digits, so they carry no LIKE wildcards.
    SELECT
        array_agg('%' || word || '%') AS inside,
        array_agg('% ' || word || '%') AS word_start
    FROM unnest($3::text[]) AS word
),
viewer_mailboxes AS MATERIALIZED (
    SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) AS ids
    FROM email_links
    WHERE macro_id = $1
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
        SELECT id, CASE WHEN id <> $1::text COLLATE "C" THEN $5::text END, TRUE
        FROM teammates
        UNION ALL
        SELECT $1::text COLLATE "C", NULL, FALSE
    ) AS directory
    GROUP BY directory.id
),
profiles AS MATERIALIZED (
    SELECT
        c.id,
        substr(c.id, length('macro|') + 1) AS email,
        c.is_teammate,
        c.lists,
        CASE
            WHEN c.lists && $6::text[] THEN 0
            WHEN c.is_teammate THEN 1
            WHEN c.lists && $7::text[] THEN 2
            ELSE 3
        END AS list_group,
        COALESCE(u."isAgent", FALSE) AS is_agent,
        NULLIF(mui.first_name, 'N/A') AS first_name,
        NULLIF(mui.last_name, 'N/A') AS last_name
    FROM candidates AS c
    LEFT JOIN "User" AS u ON u.id = c.id
    LEFT JOIN macro_user_info AS mui ON mui.macro_user_id = u.macro_user_id
),
-- The viewer's address book, read through its mailboxes only: joined on the
-- address instead, Postgres probes the address trigram index per person,
-- which searches every mailbox and takes seconds.
book_rows AS MATERIALIZED (
    SELECT
        ec.email_address AS email,
        ec.name,
        array_position((SELECT ids FROM viewer_mailboxes), ec.link_id) AS mailbox
    FROM email_contacts AS ec
    WHERE ec.link_id = ANY((SELECT ids FROM viewer_mailboxes)::uuid[])
      AND ec.name IS NOT NULL
),
-- Labels of the people without a profile name. Someone in several of the
-- viewer's mailboxes takes the label of the first that has one, as the
-- directory's names choose it.
book AS MATERIALIZED (
    SELECT DISTINCT ON (r.email COLLATE "C") r.email, r.name
    FROM book_rows AS r
    JOIN profiles AS p USING (email)
    WHERE p.first_name IS NULL AND p.last_name IS NULL
    -- Byte order: a locale-aware sort costs more than the rest of the query.
    ORDER BY r.email COLLATE "C", r.mailbox
),
names AS MATERIALIZED (
    SELECT
        p.*,
        book.name AS book_name,
        -- Lowercased, with runs of whitespace collapsed, as the local
        -- ranking normalizes names.
        regexp_replace(lower(trim(COALESCE(
            NULLIF(
                CASE
                    WHEN p.first_name IS NOT NULL OR p.last_name IS NOT NULL
                    THEN concat_ws(' ', NULLIF(p.first_name, ''), NULLIF(p.last_name, ''))
                    ELSE book.name
                END,
                ''),
            split_part(p.email, '@', 1)
        ))), '\s+', ' ', 'g') AS name
    FROM profiles AS p
    LEFT JOIN book USING (email)
),
named AS (
    SELECT
        n.*,
        (
            n.name = $2
            OR (strpos($2, ' ') = 0 AND strpos(n.name, ',') = 0 AND split_part(n.name, ' ', 1) = $2)
        ) AS is_exact
    FROM names AS n
    -- Every typed word occurs in the name: a cheap test before the word split.
    WHERE n.name LIKE ALL ((SELECT inside FROM patterns)::text[])
)
SELECT
    n.id AS "user_id!",
    n.is_teammate AS "is_teammate!",
    n.is_agent AS "is_agent!",
    n.lists AS "lists!",
    CASE
        WHEN n.first_name IS NOT NULL OR n.last_name IS NOT NULL THEN n.first_name
        ELSE split_part(n.book_name, ' ', 1)
    END AS "first_name?",
    CASE
        WHEN n.first_name IS NOT NULL OR n.last_name IS NOT NULL THEN n.last_name
        WHEN position(' ' IN n.book_name) > 0
        THEN NULLIF(trim(substring(n.book_name FROM position(' ' IN n.book_name) + 1)), '')
    END AS "last_name?"
FROM named AS n
-- Words are split on anything but letters and digits.
WHERE n.is_exact
   OR ' ' || regexp_replace(n.name, '[^[:alnum:]]+', ' ', 'g')
        LIKE ALL ((SELECT word_start FROM patterns)::text[])
-- Byte order keeps ties stable whatever the database's locale.
ORDER BY n.list_group, n.is_exact DESC, n.id COLLATE "C"
LIMIT $4
