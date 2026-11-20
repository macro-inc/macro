-- Every user and every peer gain each other in their interacted lists. Inputs
-- are bounded by the producer (10 users x 500 peers per message), so this
-- writes at most 10,000 rows. A repeat conflicts on the primary key and
-- returns nothing.
INSERT INTO contact_list_members (user_id, contact_user_id, list_key)
SELECT pair.user_id, pair.contact_user_id, $3
FROM unnest($1::text[]) AS users (id)
CROSS JOIN unnest($2::text[]) AS peers (id)
CROSS JOIN LATERAL (
    VALUES (users.id, peers.id), (peers.id, users.id)
) AS pair (user_id, contact_user_id)
WHERE users.id <> peers.id
ON CONFLICT (user_id, contact_user_id, list_key) DO NOTHING
RETURNING user_id, contact_user_id
