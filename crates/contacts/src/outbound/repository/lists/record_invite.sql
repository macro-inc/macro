-- The inviter gains the invitee in their invited list. Directed: the
-- invitee's directory is unchanged. A self-invite writes nothing, and a
-- repeat conflicts on the primary key and returns no row.
INSERT INTO contact_list_members (user_id, contact_user_id, list_key)
SELECT $1, $2, $3
WHERE $1 <> $2
ON CONFLICT (user_id, contact_user_id, list_key) DO NOTHING
RETURNING contact_user_id
