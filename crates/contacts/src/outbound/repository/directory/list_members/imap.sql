-- One page of the viewer's IMAP list, deduplicated across their inboxes.
-- $1 viewer, $2 exclusive cursor (NULL on the first page), $3 page size + 1.
-- The literal list key selects contact_inbox_members_imap_idx.
SELECT DISTINCT contact_user_id AS "contact!"
FROM contact_inbox_members
WHERE list_key = 'imap'
  AND user_id = $1
  AND contact_user_id > COALESCE($2::text, '')
ORDER BY contact_user_id
LIMIT $3
