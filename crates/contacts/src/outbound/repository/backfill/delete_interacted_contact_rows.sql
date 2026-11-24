-- Up to $2 `interacted` rows naming a deleted account, read in contact-index
-- order and deleted by row address, so every plan stays an index range plus
-- a tid scan. The account check is repeated so an account created since the
-- scan keeps its rows.
DELETE FROM contact_list_members
WHERE ctid = ANY (ARRAY(
    SELECT m.ctid
    FROM contact_list_members m
    WHERE m.contact_user_id = $1 AND m.list_key = $3
    ORDER BY m.contact_user_id, m.user_id
    LIMIT $2
))
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = $1)
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr($1, 7))
