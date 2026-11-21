-- Up to $2 of a deleted account's inbox-list rows, read in primary-key order
-- and deleted by row address: a generic plan otherwise scanned the whole
-- table and hash-joined the batch to it. The account check is repeated so an
-- account created since the scan keeps its rows.
DELETE FROM contact_inbox_members
WHERE ctid = ANY (ARRAY(
    SELECT m.ctid
    FROM contact_inbox_members m
    WHERE m.user_id = $1
    ORDER BY m.user_id, m.contact_user_id, m.link_id
    LIMIT $2
))
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = $1)
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u.email) = substr($1, 7))
