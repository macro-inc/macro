-- One page of listed contacts after $1, found by skipping through the
-- contact index one contact at a time, each with their `interacted` rows
-- when no account matches them (by id or address). Invited and inbox
-- contacts may be addresses without an account, so only `interacted` rows
-- count.
WITH RECURSIVE contacts (id) AS (
    (
        SELECT m.contact_user_id
        FROM contact_list_members m
        WHERE m.contact_user_id > $1
        ORDER BY m.contact_user_id
        LIMIT 1
    )
    UNION ALL
    SELECT (
        SELECT m.contact_user_id
        FROM contact_list_members m
        WHERE m.contact_user_id > contacts.id
        ORDER BY m.contact_user_id
        LIMIT 1
    )
    FROM contacts
    WHERE contacts.id IS NOT NULL
),
page AS (
    SELECT id FROM contacts WHERE id IS NOT NULL LIMIT $2
)
SELECT
    page.id AS "id!",
    CASE
        WHEN EXISTS (SELECT 1 FROM "User" u WHERE u.id = page.id COLLATE "default")
          OR EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr(page.id, 7) COLLATE "default")
        THEN NULL
        ELSE (
            SELECT count(*)
            FROM contact_list_members m
            WHERE m.contact_user_id = page.id AND m.list_key = $3
        )
    END AS orphaned_rows
FROM page
ORDER BY page.id
