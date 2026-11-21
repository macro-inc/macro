-- Every user and every peer gain each other in their interacted lists. Inputs
-- are bounded by the producer (10 users x 500 peers per message), so this
-- writes at most 10,000 rows. A repeat conflicts on the primary key and
-- returns nothing. Rows go in key order so two messages with overlapping
-- pairs wait on each other instead of deadlocking.
--
-- Interactions are between Macro accounts, so an id without a profile is
-- skipped: a message that arrives after its user was deleted (and their lists
-- dropped) cannot add them back. One primary-key probe per input id.
WITH users AS (
    SELECT input.id FROM unnest($1::text[]) AS input (id)
    WHERE EXISTS (SELECT 1 FROM "User" WHERE "User".id = input.id)
), peers AS (
    SELECT input.id FROM unnest($2::text[]) AS input (id)
    WHERE EXISTS (SELECT 1 FROM "User" WHERE "User".id = input.id)
)
INSERT INTO contact_list_members (user_id, contact_user_id, list_key)
SELECT pair.user_id, pair.contact_user_id, $3
FROM users
CROSS JOIN peers
CROSS JOIN LATERAL (
    VALUES (users.id, peers.id), (peers.id, users.id)
) AS pair (user_id, contact_user_id)
WHERE users.id <> peers.id
ORDER BY pair.user_id, pair.contact_user_id
ON CONFLICT (user_id, contact_user_id, list_key) DO NOTHING
RETURNING user_id, contact_user_id
