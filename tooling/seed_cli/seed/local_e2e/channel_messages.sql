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

INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0003-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'macro|bob@example.com',
    'Deep thread navigation fixture parent',
    now() - interval '1 day',
    now() - interval '1 day'
);

WITH deep_thread_replies AS (
    SELECT
        reply_number,
        (
            '00000000-0000-0000-0003-'
            || lpad((reply_number + 1)::text, 12, '0')
        )::uuid AS id,
        CASE
            WHEN reply_number = 5 THEN 'Deep thread target reply'
            WHEN reply_number = 6 THEN (
                SELECT 'Oversized target reply' || E'\n\n' || string_agg(
                    format(
                        'Oversized target paragraph %s. This single reply is intentionally taller than the channel viewport.',
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 80) AS paragraph(paragraph_number)
            )
            ELSE (
                SELECT string_agg(
                    format(
                        'Tall thread reply %s, paragraph %s. This fixture deliberately occupies enough vertical space to expose reply navigation that races the outer virtualizer measurement.',
                        reply_number,
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 24) AS paragraph(paragraph_number)
            )
        END AS content
    FROM generate_series(1, 6) AS reply(reply_number)
)
INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    thread_id,
    created_at,
    updated_at
)
SELECT
    id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    CASE
        WHEN reply_number % 2 = 0 THEN 'macro|charlie@example.com'
        ELSE 'macro|bob@example.com'
    END,
    content,
    '00000000-0000-0000-0003-000000000001'::uuid,
    now() - interval '1 day' + (reply_number || ' seconds')::interval,
    now() - interval '1 day' + (reply_number || ' seconds')::interval
FROM deep_thread_replies;

INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0003-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'macro|charlie@example.com',
    'Alternate deep thread navigation fixture parent. Navigate elsewhere: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"00000000-0000-0000-0003-000000000006","channel_thread_id":"00000000-0000-0000-0003-000000000001"},"collapsed":false}</m-document-mention>',
    now() - interval '2 days',
    now() - interval '2 days'
);

WITH alternate_thread_replies AS (
    SELECT
        reply_number,
        (
            '00000000-0000-0000-0003-'
            || lpad((reply_number + 10)::text, 12, '0')
        )::uuid AS id,
        CASE
            WHEN reply_number = 4 THEN 'Alternate deep thread target reply'
            ELSE (
                SELECT string_agg(
                    format(
                        'Alternate tall reply %s, paragraph %s. This fixture keeps a stale reply request in flight while navigation moves elsewhere.',
                        reply_number,
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 24) AS paragraph(paragraph_number)
            )
        END AS content
    FROM generate_series(1, 4) AS reply(reply_number)
)
INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    thread_id,
    created_at,
    updated_at
)
SELECT
    id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    CASE
        WHEN reply_number % 2 = 0 THEN 'macro|bob@example.com'
        ELSE 'macro|charlie@example.com'
    END,
    content,
    '00000000-0000-0000-0003-000000000010'::uuid,
    now() - interval '2 days' + (reply_number || ' seconds')::interval,
    now() - interval '2 days' + (reply_number || ' seconds')::interval
FROM alternate_thread_replies;

INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0003-000000000040'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'macro|bob@example.com',
    'Unread navigation fixture parent',
    now() - interval '3 days',
    now() - interval '3 days'
);

WITH unread_thread_replies AS (
    SELECT
        reply_number,
        (
            '00000000-0000-0000-0003-'
            || lpad((reply_number + 40)::text, 12, '0')
        )::uuid AS id,
        CASE
            WHEN reply_number = 4 THEN (
                SELECT 'Unread cache warmer reply' || E'\n\n' || string_agg(
                    format(
                        'Unread cache warmer paragraph %s. This reply keeps the notification target outside the viewport before navigation.',
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 80) AS paragraph(paragraph_number)
            )
            WHEN reply_number = 5 THEN (
                SELECT 'Unread oversized target reply' || E'\n\n' || string_agg(
                    format(
                        'Unread oversized target paragraph %s. This reply must cover more than one channel viewport.',
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 80) AS paragraph(paragraph_number)
            )
            ELSE (
                SELECT string_agg(
                    format(
                        'Unread tall reply %s, paragraph %s. This fixture spaces the target well beyond the thread root.',
                        reply_number,
                        paragraph_number
                    ),
                    E'\n\n' ORDER BY paragraph_number
                )
                FROM generate_series(1, 24) AS paragraph(paragraph_number)
            )
        END AS content
    FROM generate_series(1, 5) AS reply(reply_number)
)
INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    thread_id,
    created_at,
    updated_at
)
SELECT
    id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    CASE
        WHEN reply_number % 2 = 0 THEN 'macro|charlie@example.com'
        ELSE 'macro|bob@example.com'
    END,
    content,
    '00000000-0000-0000-0003-000000000040'::uuid,
    now() - interval '3 days' + (reply_number || ' seconds')::interval,
    now() - interval '3 days' + (reply_number || ' seconds')::interval
FROM unread_thread_replies;

INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0003-000000000020'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'macro|bob@example.com',
    'Navigation race A: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"00000000-0000-0000-0003-000000000014","channel_thread_id":"00000000-0000-0000-0003-000000000010"},"collapsed":false}</m-document-mention> Navigation target B: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"00000000-0000-0000-0003-000000000006","channel_thread_id":"00000000-0000-0000-0003-000000000001"},"collapsed":false}</m-document-mention>',
    now() + interval '2 hours',
    now() + interval '2 hours'
);

INSERT INTO comms_messages (
    id,
    channel_id,
    sender_id,
    content,
    created_at,
    updated_at
)
VALUES
(
    '00000000-0000-0000-0003-000000000030'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    'macro|bob@example.com',
    'Open general at its latest message: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{},"collapsed":false}</m-document-mention>',
    now() + interval '3 hours',
    now() + interval '3 hours'
),
(
    '00000000-0000-0000-0003-000000000031'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid,
    'macro|charlie@example.com',
    'Open a specific reply in general: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"00000000-0000-0000-0003-000000000006","channel_thread_id":"00000000-0000-0000-0003-000000000001"},"collapsed":false}</m-document-mention>',
    now() + interval '3 hours',
    now() + interval '3 hours'
),
(
    '00000000-0000-0000-0003-000000000032'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid,
    'macro|bob@example.com',
    'Warm the unread target in general: <m-document-mention>{"documentId":"00000000-0000-0000-0000-000000000001","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"00000000-0000-0000-0003-000000000044","channel_thread_id":"00000000-0000-0000-0003-000000000040"},"collapsed":false}</m-document-mention>',
    now() + interval '3 hours 1 minute',
    now() + interval '3 hours 1 minute'
);

INSERT INTO notification (
    id,
    notification_event_type,
    event_item_id,
    event_item_type,
    service_sender,
    metadata,
    sender_id,
    created_at
)
VALUES (
    '00000000-0000-0000-0004-000000000001'::uuid,
    'channel_mention',
    '00000000-0000-0000-0000-000000000001',
    'channel',
    'local-e2e',
    jsonb_build_object(
        'channelName', 'general',
        'channelType', 'public',
        'messageContent', 'Unread oversized target reply',
        'messageId', '00000000-0000-0000-0003-000000000045',
        'threadId', '00000000-0000-0000-0003-000000000040',
        'senderDisplayName', 'Bob'
    ),
    'macro|bob@example.com',
    now() + interval '4 hours'
);

INSERT INTO user_notification (
    user_id,
    notification_id,
    created_at
)
VALUES (
    'macro|e2e@macro.local',
    '00000000-0000-0000-0004-000000000001'::uuid,
    now() + interval '4 hours'
);
