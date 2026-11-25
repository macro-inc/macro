        SELECT ae.entity_type, ae.entity_id, ae.occurred_at AS touched_at
        FROM activity_events ae
        WHERE $9
        AND ae.subject_id = $1
        AND {own_work_ae}
        AND ae.entity_type = ANY($2)
        AND ae.entity_type <> 'channel_message'
        AND ($3::timestamptz IS NULL OR (ae.occurred_at, ae.entity_id) < ($3, $4))
        AND NOT EXISTS (
            SELECT 1 FROM activity_events newer
            WHERE newer.subject_id = $1
            AND newer.entity_type = ae.entity_type
            AND newer.entity_id = ae.entity_id
            AND {own_work_newer}
            AND (newer.occurred_at, newer.id) > (ae.occurred_at, ae.id)
        )
        ORDER BY ae.occurred_at DESC, ae.entity_id DESC
        OFFSET 0
