-- One page of the viewer's gmail list: everyone known through one of their
-- gmail inboxes, each once, in byte order after the cursor. $1 viewer, $2
-- exclusive cursor (NULL on the first page), $3 page size + 1.
-- One range read of the partial index contact_inbox_members_gmail_idx from
-- the cursor; the list is a literal so that index applies. A contact known
-- through two inboxes is read twice and returned once.
SELECT DISTINCT contact_user_id AS "contact!"
FROM contact_inbox_members
WHERE list_key = 'gmail'
  AND user_id = $1
  AND contact_user_id > COALESCE($2::text, '')
ORDER BY contact_user_id
LIMIT $3
