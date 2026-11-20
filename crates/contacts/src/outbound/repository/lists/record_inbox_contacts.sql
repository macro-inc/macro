-- The inbox owner gains each contact through this inbox (at most 500 per
-- message). Nothing is written once the inbox is disconnected, so a message
-- that outlives its link is a no-op instead of a foreign-key failure; the key
-- share lock makes a disconnect that races this statement wait for it. Rows go
-- in key order so overlapping messages cannot deadlock.
INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
SELECT $1, contacts.id, $2, $3
FROM unnest($4::text[]) AS contacts (id)
WHERE contacts.id <> $1
  AND EXISTS (SELECT 1 FROM email_links WHERE email_links.id = $2 FOR KEY SHARE)
ORDER BY contacts.id
ON CONFLICT (user_id, contact_user_id, link_id) DO NOTHING
RETURNING contact_user_id
