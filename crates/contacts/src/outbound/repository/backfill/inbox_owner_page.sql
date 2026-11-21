-- One page of inbox owners in owner order (idx_email_links_macro_id), each
-- with their inboxes. Inboxes being disconnected are left out: their rows
-- would be removed with them.
SELECT
    l.macro_id AS owner,
    array_agg(l.id ORDER BY l.id) AS "link_ids!",
    array_agg(l.provider::text ORDER BY l.id) AS "providers!"
FROM email_links l
WHERE l.macro_id > $1
  AND l.deleting_at IS NULL
  AND l.disconnect_requested_at IS NULL
GROUP BY l.macro_id
ORDER BY l.macro_id
LIMIT $2
