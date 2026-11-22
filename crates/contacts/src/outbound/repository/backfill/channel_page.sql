-- One page of channels in id order. A private channel named like a signup
-- support channel is flagged; whether it holds a support-roster address is
-- decided from its members. The first page starts after the nil uuid, so no
-- nullable cursor turns the bound into a filter.
SELECT
    c.id,
    c.channel_type::text AS "channel_type!",
    (c.channel_type = 'private' AND c.name LIKE 'Macro Support x %') AS "support_name!"
FROM comms_channels c
WHERE c.id > $1
ORDER BY c.id
LIMIT $2
