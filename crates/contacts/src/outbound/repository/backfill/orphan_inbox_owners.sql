-- One page of inbox-list owners after $1, found by skipping through the primary
-- key one owner at a time (Postgres 14 has no skip scan), each with the rows
-- they own when no account matches them. An owner matches an account by id
-- or by the account's address, so a legacy-cased "User" id is never taken
-- for a deleted account.
WITH RECURSIVE owners (id) AS (
    (
        SELECT m.user_id
        FROM contact_inbox_members m
        WHERE m.user_id > $1
        ORDER BY m.user_id
        LIMIT 1
    )
    UNION ALL
    SELECT (
        SELECT m.user_id
        FROM contact_inbox_members m
        WHERE m.user_id > owners.id
        ORDER BY m.user_id
        LIMIT 1
    )
    FROM owners
    WHERE owners.id IS NOT NULL
),
page AS (
    SELECT id FROM owners WHERE id IS NOT NULL LIMIT $2
)
SELECT
    page.id AS "id!",
    CASE
        WHEN EXISTS (SELECT 1 FROM "User" u WHERE u.id = page.id COLLATE "default")
          OR EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr(page.id, 7) COLLATE "default")
        THEN NULL
        ELSE (SELECT count(*) FROM contact_inbox_members m WHERE m.user_id = page.id)
    END AS orphaned_rows
FROM page
ORDER BY page.id
