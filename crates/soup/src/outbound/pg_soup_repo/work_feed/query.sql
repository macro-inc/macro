WITH user_source_ids AS (
    SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL
    SELECT t.team_id::text FROM team_user t
        WHERE t.user_id = $1
    UNION ALL
    SELECT $1
),
only_keys AS MATERIALIZED (
    SELECT k.entity_type, k.entity_id
    FROM unnest($10::text[], $11::text[]) AS k(entity_type, entity_id)
),
notified AS NOT MATERIALIZED (
    SELECT
        un.created_at,
        un.state,
        CASE WHEN n.event_item_type = 'channel'
                AND n.secondary_event_item_type = 'channel_message'
            THEN 'channel_message' ELSE n.event_item_type
        END AS entity_type,
        CASE WHEN n.event_item_type = 'channel'
                AND n.secondary_event_item_type = 'channel_message'
            THEN n.secondary_event_item_id ELSE n.event_item_id
        END AS entity_id
    FROM user_notification un
    JOIN notification n ON n.id = un.notification_id
    WHERE un.user_id = $1
    AND un.deleted_at IS NULL
),
attention AS NOT MATERIALIZED (
    SELECT
        entity_type,
        entity_id,
        max(created_at) AT TIME ZONE 'UTC' AS attention_at
    FROM notified
    WHERE entity_type = ANY($2)
    GROUP BY entity_type, entity_id
    HAVING bool_or(state <> 'done')
),
attention_page AS (
    SELECT nc.entity_type, nc.entity_id, nc.attention_at, nc.touched_at
    FROM (
        SELECT
            ordered.entity_type,
            ordered.entity_id,
            ordered.attention_at,
            latest_own.occurred_at AS touched_at
        FROM (
            SELECT entity_type, entity_id, attention_at
            FROM attention
            WHERE ($3::timestamptz IS NULL OR (attention_at, entity_id) < ($3, $4))
            AND ($10::text[] IS NULL OR (entity_type, entity_id) IN (
                SELECT entity_type, entity_id FROM only_keys
            ))
            ORDER BY attention_at DESC, entity_id DESC
            OFFSET 0
        ) ordered
        LEFT JOIN LATERAL (
            SELECT ae.occurred_at
            FROM activity_events ae
            WHERE $9
            AND ae.subject_id = $1
            AND ae.entity_type = ordered.entity_type
            AND ae.entity_id = ordered.entity_id
            AND {own_work_ae}
            ORDER BY ae.occurred_at DESC
            LIMIT 1
        ) latest_own ON TRUE
    ) nc
    WHERE (nc.touched_at IS NULL OR nc.touched_at <= nc.attention_at)
    AND (nc.entity_type <> 'email_thread' OR {email_inbox_gate})
    AND CASE nc.entity_type
        WHEN 'document' THEN {document_gate}
        WHEN 'chat' THEN {chat_gate}
        WHEN 'project' THEN {project_gate}
        WHEN 'initiative' THEN {initiative_gate}
        WHEN 'channel' THEN {channel_gate}
        WHEN 'channel_message' THEN {channel_thread_gate}
        WHEN 'email_thread' THEN {email_gate}
        WHEN 'calendar_event' THEN {calendar_event_gate}
        WHEN 'foreign_entity' THEN {foreign_entity_gate}
        WHEN 'agent_session' THEN {agent_session_gate}
        ELSE FALSE
    END
    ORDER BY nc.attention_at DESC, nc.entity_id DESC
    LIMIT $6
),
own_page AS (
    SELECT nc.entity_type, nc.entity_id, nc.touched_at
    FROM (
        SELECT ae.entity_type, ae.entity_id, ae.occurred_at AS touched_at
        FROM activity_events ae
        WHERE $9
        AND ae.subject_id = $1
        AND {own_work_ae}
        AND ae.entity_type = ANY($2)
        AND ae.entity_type <> 'channel_message'
        AND ($3::timestamptz IS NULL OR (ae.occurred_at, ae.entity_id) < ($3, $4))
        AND ($10::text[] IS NULL OR (ae.entity_type, ae.entity_id) IN (
            SELECT entity_type, entity_id FROM only_keys
        ))
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
    ) nc
    -- The attention stream owns a candidate whose live attention is at least
    -- as new as this touch; skipping it here emits every candidate once.
    WHERE NOT (
        {attention_pending}
        AND {attention_since_touch}
        AND (nc.entity_type <> 'email_thread' OR {email_inbox_gate})
    )
    AND CASE nc.entity_type
        WHEN 'document' THEN {document_gate}
        WHEN 'chat' THEN {chat_gate}
        WHEN 'project' THEN {project_gate}
        WHEN 'initiative' THEN {initiative_gate}
        WHEN 'channel' THEN {channel_gate}
        WHEN 'email_thread' THEN {email_gate}
        WHEN 'calendar_event' THEN {calendar_event_gate}
        WHEN 'foreign_entity' THEN {foreign_entity_gate}
        WHEN 'agent_session' THEN {agent_session_gate}
        ELSE FALSE
    END
    ORDER BY nc.touched_at DESC, nc.entity_id DESC
    LIMIT $6
)
SELECT entity_type, entity_id, attention_at, touched_at, sort_at
FROM (
    SELECT entity_type, entity_id, attention_at, touched_at, attention_at AS sort_at
    FROM attention_page
    UNION ALL
    SELECT o.entity_type, o.entity_id, {own_attention_at}, o.touched_at, o.touched_at AS sort_at
    FROM own_page o
) merged
ORDER BY sort_at DESC, entity_id DESC
LIMIT $6
