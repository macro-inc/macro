::text AS user_id),
user_source_ids AS (
    SELECT cp.channel_id::text AS source_id
    FROM comms_channel_participants cp, viewer
    WHERE cp.user_id = viewer.user_id AND cp.left_at IS NULL
    UNION ALL
    SELECT tu.team_id::text FROM team_user tu, viewer WHERE tu.user_id = viewer.user_id
    UNION ALL
    SELECT user_id FROM viewer
),
call_headers AS (
    SELECT c.id AS call_id, c.channel_id, c.created_by,
           c.created_at AS started_at, NULL::timestamptz AS ended_at,
           c.share_permission_id, 'active'::text AS source_kind
    FROM calls c
    UNION ALL
    SELECT cr.id, cr.channel_id, cr.created_by, cr.started_at, cr.ended_at,
           cr.share_permission_id, 'archived'::text
    FROM call_records cr
    UNION ALL
    SELECT ce.id, ce.channel_id, ce.user_id, COALESCE(ce.started_at, ce.created_at),
           ce.ended_at, ce.share_permission_id, 'imported'::text
    FROM call_entities ce
    WHERE ce.created_via <> 'native'
),
visible_calls AS (
    SELECT h.*,
           CASE
               WHEN h.source_kind = 'imported' THEN
                   CASE WHEN h.created_by = viewer.user_id THEN 'ATTENDED' ELSE 'UNATTENDED' END
               WHEN (h.source_kind = 'active' AND EXISTS (
                   SELECT 1 FROM call_participants cp
                   WHERE cp.call_id = h.call_id AND cp.user_id = viewer.user_id
               )) OR (h.source_kind = 'archived' AND EXISTS (
                   SELECT 1 FROM call_record_participants cp
                   WHERE cp.call_record_id = h.call_id AND cp.user_id = viewer.user_id
               )) THEN 'ATTENDED'
               WHEN EXISTS (
                   SELECT 1 FROM comms_channel_participants cp
                   WHERE cp.channel_id = h.channel_id AND cp.user_id = viewer.user_id
                     AND cp.left_at IS NULL
               ) THEN 'MISSED'
               ELSE 'UNATTENDED'
           END AS status
    FROM call_headers h
    JOIN "SharePermission" sp ON sp.id = h.share_permission_id
    CROSS JOIN viewer
    WHERE EXISTS (
        SELECT 1 FROM entity_access ea
        JOIN user_source_ids source ON source.source_id = ea.source_id
        WHERE ea.entity_id = h.call_id AND ea.entity_type = 'call'
          AND (h.channel_id IS NOT NULL OR (ea.source_type = 'user' AND ea.source_id = viewer.user_id))
    )
)
