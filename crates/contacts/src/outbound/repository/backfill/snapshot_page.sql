-- One page of the April 2026 channel snapshot in id order, keeping the Macro
-- users it lists that still have an account. A row lists one channel, so
-- each array is bounded by that channel's size.
SELECT
    o.id,
    o.comms_channel_id AS channel_id,
    o.created_at,
    ARRAY(
        SELECT DISTINCT listed.id
        FROM jsonb_array_elements_text(o.user_ids) AS listed (id)
        WHERE listed.id COLLATE "C" LIKE 'macro|%'
          AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = listed.id)
    ) AS "user_ids!"
FROM contacts_backfill_outbox o
WHERE o.id > $1
ORDER BY o.id
LIMIT $2
