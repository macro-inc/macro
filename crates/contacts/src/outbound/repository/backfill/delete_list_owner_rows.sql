-- Up to $2 of a deleted account's list rows (primary key prefix). The
-- account check is repeated so an account created since the scan keeps its
-- rows.
DELETE FROM contact_list_members
WHERE (user_id, contact_user_id, list_key) IN (
    SELECT m.user_id, m.contact_user_id, m.list_key
    FROM contact_list_members m
    WHERE m.user_id = $1
    LIMIT $2
)
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = $1)
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr($1, 7))
