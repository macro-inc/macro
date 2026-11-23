    SELECT
        found.entity_type,
        found.entity_id,
        max(found.created_at) AT TIME ZONE 'UTC' AS attention_at
    FROM (
        -- Notifications filed under the key, as in `pending_only.sql`, except
        -- that a channel notification naming a thread places that thread, not
        -- the channel. Only channel rows can name one, so only they read
        -- their notification row to tell; the probe then walks past them to
        -- the newest row that stays on the channel.
        SELECT k.entity_type, k.entity_id, filed.created_at
        FROM (
            SELECT keys.entity_type, keys.entity_id, pending_state.state
            FROM only_keys keys
            CROSS JOIN (
                VALUES ('unseen'::notification_state), ('seen'::notification_state)
            ) AS pending_state(state)
            WHERE keys.entity_type = ANY($2)
            OFFSET 0
        ) k
        CROSS JOIN LATERAL (
            SELECT un.created_at
            FROM user_notification un
            WHERE un.user_id = $1
            AND un.event_item_type = k.entity_type
            AND un.event_item_id = k.entity_id
            AND un.state = k.state
            AND un.deleted_at IS NULL
            AND un.created_at >= COALESCE(
                (SELECT floor_at AT TIME ZONE 'UTC' FROM attention_floor),
                '-infinity'
            )
            AND (un.event_item_type <> 'channel' OR NOT EXISTS (
                SELECT 1 FROM notification n
                WHERE n.id = un.notification_id
                AND {thread_keyed}
            ))
            ORDER BY un.created_at DESC
            LIMIT 1
            OFFSET 0
        ) filed
        UNION ALL
        -- Notifications that place a thread key: channel notifications naming
        -- it as their secondary item. idx_notification_secondary_event_type_id
        -- reaches the thread's notifications, whoever received them, and one
        -- primary-key probe per notification finds the viewer's pending row,
        -- so the read follows the thread's notifications, not the viewer's.
        -- The fence keeps the channel check out of that scan: with it inside,
        -- a stale plan also read every channel notification through
        -- notification_channel_message_id_idx (partial on channel rows).
        SELECT keys.entity_type, keys.entity_id, viewer.created_at
        FROM only_keys keys
        CROSS JOIN LATERAL (
            SELECT n.id, n.event_item_type
            FROM notification n
            WHERE n.secondary_event_item_type = 'channel_message'
            AND n.secondary_event_item_id = keys.entity_id
            OFFSET 0
        ) n
        CROSS JOIN LATERAL (
            SELECT un.created_at
            FROM user_notification un
            WHERE un.user_id = $1
            AND un.notification_id = n.id
            AND un.deleted_at IS NULL
            AND un.state <> 'done'
            AND un.created_at >= COALESCE(
                (SELECT floor_at AT TIME ZONE 'UTC' FROM attention_floor),
                '-infinity'
            )
            OFFSET 0
        ) viewer
        WHERE keys.entity_type = 'channel_message'
        AND keys.entity_type = ANY($2)
        AND n.event_item_type = 'channel'
    ) found
    GROUP BY found.entity_type, found.entity_id
