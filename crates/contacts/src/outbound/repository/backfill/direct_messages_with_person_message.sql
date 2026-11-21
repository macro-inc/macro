-- The DMs among a page of ids with a message a person sent, at or after $2
-- when given. Each probe walks one DM's messages newest first
-- (idx_comms_messages_parent_history) and stops at the first that counts:
-- a message, not a call root, from a Macro user, not imported.
SELECT dm.id AS "id!"
FROM unnest($1::uuid[]) AS dm (id)
WHERE EXISTS (
    SELECT 1
    FROM comms_messages m
    WHERE m.parent_entity_type = 'channel'
      AND m.parent_entity_id = dm.id::text
      AND m.created_at >= COALESCE($2::timestamptz, '-infinity')
      AND m.kind = 'message'
      AND m.sender_id COLLATE "C" LIKE 'macro|%'
      AND m.import_metadata IS NULL
)
