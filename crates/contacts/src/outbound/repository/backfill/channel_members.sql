-- The Macro users in a page of channels (primary key prefix). Bots, guests
-- and deleted accounts are never contacts, so their rows are not read.
SELECT
    p.channel_id,
    p.user_id,
    p.joined_at,
    p.left_at
FROM comms_channel_participants p
WHERE p.channel_id = ANY($1::uuid[])
  AND p.user_id COLLATE "C" LIKE 'macro|%'
  AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = p.user_id)
