WITH user_source_ids AS (
    SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL
    SELECT t.team_id::text FROM team_user t
        WHERE t.user_id = $1
    UNION ALL
    SELECT $1
),
notified AS NOT MATERIALIZED (
    SELECT
        un.created_at,
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
latest AS NOT MATERIALIZED (
    SELECT
        entity_type,
        entity_id,
        max(created_at) AS created_at
    FROM notified
    WHERE entity_type = ANY($2)
    GROUP BY entity_type, entity_id
)
SELECT nc.entity_type, nc.entity_id, nc.notified_at
FROM (
    SELECT entity_type, entity_id, created_at AS notified_at
    FROM latest
    WHERE ($3::timestamp IS NULL OR (created_at, entity_id) < ($3, $4))
    ORDER BY created_at DESC, entity_id DESC
    OFFSET 0
) nc
WHERE CASE nc.entity_type
    WHEN 'document' THEN {document_gate}
    WHEN 'chat' THEN {chat_gate}
    WHEN 'project' THEN {project_gate}
    WHEN 'channel' THEN {channel_gate}
    WHEN 'channel_message' THEN {channel_thread_gate}
    WHEN 'email_thread' THEN {email_gate}
    WHEN 'calendar_event' THEN {calendar_event_gate}
    WHEN 'foreign_entity' THEN {foreign_entity_gate}
    WHEN 'reminder' THEN {reminder_gate}
    WHEN 'agent_session' THEN {agent_session_gate}
    ELSE FALSE
END
ORDER BY nc.notified_at DESC, nc.entity_id DESC
LIMIT $6
