-- People in the viewer's directory (their contact graph in both directions,
-- self, and current team) whom the typed text names, as the local people
-- ranking's two name stages decide it: the whole name, or for one word the
-- first name, equals the text; or every typed word starts a word of the name.
-- The name is the one the directory shows: the Macro profile name, else the
-- viewer's own address-book label, else the address's local part.
-- Teammates come first; within each group exact matches, then byte-ordered
-- ids.
-- $1 viewer id, $2 typed text, $3 result limit.
-- Peers are read through contacts_connections_user1_user2_key and
-- idx_contacts_connections_user2_user1; each then costs the "User" and
-- macro_user_info probes the ranked search pays. The viewer's address book is
-- read once and hash-joined to the people without a profile name.
WITH typed AS MATERIALIZED (
    -- Normalized by the same lower() and whitespace rules as the names below,
    -- so the text and a name compare alike under any collation.
    SELECT trim(regexp_replace(lower($2::text), '\s+', ' ', 'g')) AS text
),
patterns AS MATERIALIZED (
    -- The text's distinct words, split on anything but letters and digits
    -- like the names' words, so they carry no LIKE wildcards. Text without a
    -- word leaves both arrays null, which matches no name.
    SELECT
        array_agg('%' || word || '%') AS inside,
        array_agg('% ' || word || '%') AS word_start
    FROM (
        SELECT DISTINCT word
        FROM regexp_split_to_table((SELECT text FROM typed), '[^[:alnum:]]+') AS word
        WHERE word <> ''
    ) AS words
),
viewer_mailboxes AS MATERIALIZED (
    SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) AS ids
    FROM email_links
    WHERE macro_id = $1
),
candidates AS MATERIALIZED (
    SELECT directory.id, bool_or(directory.is_teammate) AS is_teammate
    FROM (
        -- Fold case like the scoped peer indexes, then return to the default
        -- collation so the joins below can use "User" and email_contacts keys.
        SELECT lower(user2 COLLATE "C") COLLATE "default" AS id, FALSE AS is_teammate
        FROM contacts_connections
        WHERE user1 = $1
          AND user2 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT lower(user1 COLLATE "C") COLLATE "default", FALSE
        FROM contacts_connections
        WHERE user2 = $1
          AND user1 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT lower($1::text COLLATE "C") COLLATE "default", FALSE
        UNION ALL
        -- A user has at most one team; its members include the viewer.
        SELECT lower(teammate.user_id COLLATE "C") COLLATE "default", TRUE
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
    ) AS directory
    GROUP BY directory.id
),
profiles AS MATERIALIZED (
    SELECT
        c.id,
        substr(c.id, length('macro|') + 1) AS email,
        c.is_teammate,
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
        shown.*,
        -- The name the directory shows (`ContactName::display_name`: its
        -- parts without empty or N/A ones), else the address's local part,
        -- normalized like the text.
        trim(regexp_replace(lower(COALESCE(
            NULLIF(concat_ws(' ',
                NULLIF(NULLIF(shown.shown_first, 'N/A'), ''),
                NULLIF(NULLIF(shown.shown_last, 'N/A'), '')), ''),
            split_part(shown.email, '@', 1)
        )), '\s+', ' ', 'g')) AS name
    FROM (
        -- Same precedence as the directory's names: a Macro profile name
        -- wins; otherwise the viewer's own label, split at its first space.
        SELECT
            p.*,
            CASE
                WHEN p.first_name IS NOT NULL OR p.last_name IS NOT NULL THEN p.first_name
                ELSE split_part(book.name, ' ', 1)
            END AS shown_first,
            CASE
                WHEN p.first_name IS NOT NULL OR p.last_name IS NOT NULL THEN p.last_name
                WHEN position(' ' IN book.name) > 0
                THEN NULLIF(trim(substring(book.name FROM position(' ' IN book.name) + 1)), '')
            END AS shown_last
        FROM profiles AS p
        LEFT JOIN book USING (email)
    ) AS shown
),
named AS (
    SELECT
        n.*,
        (
            n.name = (SELECT text FROM typed)
            OR (
                strpos((SELECT text FROM typed), ' ') = 0
                AND strpos(n.name, ',') = 0
                AND split_part(n.name, ' ', 1) = (SELECT text FROM typed)
            )
        ) AS is_exact
    FROM names AS n
    -- Every typed word occurs in the name: a cheap test before the word split.
    WHERE n.name LIKE ALL ((SELECT inside FROM patterns)::text[])
)
SELECT
    n.id AS "user_id!",
    n.is_teammate AS "is_teammate!",
    n.is_agent AS "is_agent!",
    n.shown_first AS "first_name?",
    n.shown_last AS "last_name?"
FROM named AS n
-- Words are split on anything but letters and digits.
WHERE n.is_exact
   OR ' ' || regexp_replace(n.name, '[^[:alnum:]]+', ' ', 'g')
        LIKE ALL ((SELECT word_start FROM patterns)::text[])
-- Byte order keeps ties stable whatever the database's locale.
ORDER BY n.is_teammate DESC, n.is_exact DESC, n.id COLLATE "C"
LIMIT $3
