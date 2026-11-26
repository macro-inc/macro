SELECT channel.id AS channel_id,
       grant_row.access_level AS "access_level: AccessLevel",
       channel.name AS channel_name,
       channel.channel_type AS "channel_type: ChannelType"
FROM entity_access grant_row
JOIN comms_channels channel ON channel.id = CASE
    WHEN grant_row.source_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN grant_row.source_id::uuid
END
JOIN comms_channel_participants member
    ON member.channel_id = channel.id
   AND member.user_id = $2
   AND member.left_at IS NULL
WHERE grant_row.entity_id = $1
  AND grant_row.entity_type = 'email_thread'
  AND grant_row.source_type = 'channel'
  AND grant_row.granted_from_project_id IS NULL
ORDER BY channel.id
