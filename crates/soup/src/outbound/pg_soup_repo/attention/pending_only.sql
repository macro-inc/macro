    SELECT
        k.entity_type,
        k.entity_id,
        max(filed.created_at) AT TIME ZONE 'UTC' AS attention_at
    -- Each key once per pending state, so the state reaches the index as an
    -- equality: `state <> 'done'` or `IN` is checked on every row of an
    -- item's done history instead.
    FROM (
        SELECT keys.entity_type, keys.entity_id, pending_state.state
        FROM only_keys keys
        CROSS JOIN (
            VALUES ('unseen'::notification_state), ('seen'::notification_state)
        ) AS pending_state(state)
        WHERE keys.entity_type = ANY($2)
        OFFSET 0
    ) k
    -- One index probe per key and state. A notification is filed under the
    -- entity copied onto its recipient row, so idx_user_notification_viewer_entity
    -- reaches a key's pending rows and no other notification of the viewer's
    -- is read. Only the newest row is wanted and the index holds a key's
    -- rows newest first, so the probe stops at one entry however many
    -- pending notifications the item has. Fenced so the keys always drive
    -- the join: joined the other way round, every notification the viewer
    -- has is compared with every key.
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
        ORDER BY un.created_at DESC
        LIMIT 1
        OFFSET 0
    ) filed
    GROUP BY k.entity_type, k.entity_id
