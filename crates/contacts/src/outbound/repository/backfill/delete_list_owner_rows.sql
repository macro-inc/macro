-- Up to $2 of a deleted account's list rows, read in primary-key order and
-- deleted by row address, so every plan stays an index range plus a tid
-- scan. The account check is repeated so an account created since the scan
-- keeps its rows.
DELETE FROM contact_list_members
WHERE ctid = ANY (ARRAY(
    SELECT m.ctid
    FROM contact_list_members m
    WHERE m.user_id = $1
    ORDER BY m.user_id, m.contact_user_id, m.list_key
    LIMIT $2
))
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = $1)
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr($1, 7))
