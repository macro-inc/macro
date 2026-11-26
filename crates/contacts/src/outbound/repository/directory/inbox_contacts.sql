-- Everyone the viewer knows through a connected inbox, each once. $1 viewer.
-- One range read of the (user_id, contact_user_id, link_id) primary key; a
-- contact known through two inboxes is read twice and returned once.
SELECT DISTINCT contact_user_id AS "contact!"
FROM contact_inbox_members
WHERE user_id = $1
