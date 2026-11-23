-- One page of the viewer's invited list, in byte order after the cursor.
-- $1 viewer, $2 exclusive cursor (NULL on the first page), $3 page size + 1.
-- One range read of the partial index contact_list_members_invited_idx from
-- the cursor; the list is a literal so that index applies.
SELECT contact_user_id AS "contact!"
FROM contact_list_members
WHERE list_key = 'invited'
  AND user_id = $1
  AND contact_user_id > COALESCE($2::text, '')
ORDER BY contact_user_id
LIMIT $3
