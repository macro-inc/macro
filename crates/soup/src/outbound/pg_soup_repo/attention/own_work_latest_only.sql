        -- Each known item's latest own work, read from the item's own
        -- activity (idx_activity_events_subject_entity), however much else
        -- the viewer has done.
        SELECT keys.entity_type, keys.entity_id, latest.occurred_at AS touched_at
        FROM (SELECT DISTINCT entity_type, entity_id FROM only_keys) keys
        CROSS JOIN LATERAL (
            SELECT ae.occurred_at
            FROM activity_events ae
            WHERE $9
            AND ae.subject_id = $1
            AND ae.entity_type = keys.entity_type
            AND ae.entity_id = keys.entity_id
            AND {own_work_ae}
            ORDER BY ae.occurred_at DESC, ae.id DESC
            LIMIT 1
        ) latest
        WHERE keys.entity_type = ANY($2)
        AND keys.entity_type <> 'channel_message'
        AND ($3::timestamptz IS NULL OR (latest.occurred_at, keys.entity_id) < ($3, $4))
        ORDER BY latest.occurred_at DESC, keys.entity_id DESC
        OFFSET 0
