    SELECT
        notified.entity_type,
        notified.entity_id,
        max(un.created_at) AT TIME ZONE 'UTC' AS attention_at
    FROM user_notification un
    -- One primary-key probe per pending row. Estimates of both sides are
    -- poor, and a hash join would scan every user's notifications instead.
    CROSS JOIN LATERAL (
        SELECT
            CASE WHEN {thread_keyed}
                THEN 'channel_message' ELSE n.event_item_type
            END AS entity_type,
            CASE WHEN {thread_keyed}
                THEN n.secondary_event_item_id ELSE n.event_item_id
            END AS entity_id
        FROM notification n
        WHERE n.id = un.notification_id
        OFFSET 0
    ) notified
    WHERE un.user_id = $1{probe_skips_pending}
    AND un.deleted_at IS NULL
    AND un.state <> 'done'
    AND un.created_at >= COALESCE(
        (SELECT floor_at AT TIME ZONE 'UTC' FROM attention_floor),
        '-infinity'
    )
    AND notified.entity_type = ANY($2)
    GROUP BY notified.entity_type, notified.entity_id
