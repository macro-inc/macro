WITH local_e2e_channels AS (
    SELECT
        channel.id,
        array_agg(participant.user_id ORDER BY participant.user_id) AS sender_ids
    FROM comms_channels AS channel
    JOIN comms_channel_participants AS participant
        ON participant.channel_id = channel.id
        AND participant.left_at IS NULL
    WHERE channel.id::text LIKE '00000000-0000-0000-0000-00000000000%'
    GROUP BY channel.id
)
INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, updated_at)
SELECT
    md5('local-e2e-scroll-' || channel.id::text || '-' || message_number)::uuid,
    channel.id,
    channel.sender_ids[
        1 + ((message_number - 1) % cardinality(channel.sender_ids))::integer
    ],
    CASE
        WHEN message_number % 7 = 0 THEN repeat('Variable-height scroll fixture message ' || message_number || '. ', 12)
        ELSE 'Scroll fixture message ' || message_number
    END,
    now() + (message_number || ' milliseconds')::interval,
    now() + (message_number || ' milliseconds')::interval
FROM local_e2e_channels AS channel
CROSS JOIN generate_series(1, 5000) AS message_number;
