WITH requested AS (
    SELECT entity_id, entity_type
    FROM unnest($2::text[], $3::text[]) AS entities(entity_id, entity_type)
),
-- Scope uses all active notifications, not just the requested states: a
-- seen reply still assigns an unseen root send to its thread row.
-- Build scope evidence once per batch, never rescan history per send.
channel_scopes AS MATERIALIZED (
    SELECT DISTINCT n.event_item_id AS channel_id,
           CASE WHEN n.notification_event_type = 'channel_mention'
               THEN COALESCE(n.metadata->>'messageId', n.metadata->>'message_id')
           END AS mentioned_message_id,
           COALESCE(n.metadata->>'threadId', n.metadata->>'thread_id') AS thread_id
    FROM requested
    JOIN notification n
      ON n.event_item_id = requested.entity_id AND n.event_item_type = 'channel'
    CROSS JOIN LATERAL (
        SELECT un.notification_id
        FROM user_notification un
        WHERE un.notification_id = n.id AND un.user_id = $1
          AND un.deleted_at IS NULL AND un.state = ANY($9::notification_state[])
        -- Keep the primary-key lookup parameterized by the notification ID.
        OFFSET 0
    ) viewer_notification
    WHERE $8::bool AND requested.entity_type = 'channel'
      AND n.notification_event_type IN ('channel_mention', 'channel_message_reply')
)
SELECT requested.entity_id AS "requested_id!",
       requested.entity_type AS "requested_type!",
       matched.notification_id AS "notification_id!",
       matched.event_item_id AS "event_item_id!",
       matched.event_item_type AS "event_item_type!",
       matched.notification_event_type AS "notification_event_type!",
       matched.sent AS "sent!",
       matched.state AS "state!: NotificationState",
       matched.created_at AS "created_at!",
       matched.viewed_at,
       matched.notification_metadata,
       matched.sender_id
FROM requested
CROSS JOIN LATERAL (
    SELECT un.notification_id, n.event_item_id, n.event_item_type,
           n.notification_event_type, un.sent, un.state,
           un.created_at::timestamptz AS created_at,
           un.seen_at::timestamptz AS viewed_at,
           n.metadata AS notification_metadata, n.sender_id
    FROM (
        SELECT n.id FROM notification n
        WHERE n.event_item_id = requested.entity_id AND n.event_item_type = requested.entity_type
        UNION
        SELECT n.id FROM notification n
        WHERE n.secondary_event_item_id = requested.entity_id AND n.secondary_event_item_type = requested.entity_type
        UNION
        SELECT n.id FROM notification n
        WHERE requested.entity_type = 'channel_message'
          AND COALESCE(n.metadata->>'messageId', n.metadata->>'message_id', '') = requested.entity_id
    ) entity_notifications
    CROSS JOIN LATERAL (
        SELECT un.notification_id, un.sent, un.state, un.created_at, un.seen_at
        FROM user_notification un
        WHERE un.notification_id = entity_notifications.id AND un.user_id = $1
          AND un.deleted_at IS NULL AND un.state = ANY($4::notification_state[])
        -- Prevent subquery flattening: a plain JOIN can scan the viewer's entire
        -- history once per entity even with LIMIT 1. The composite primary key
        -- bounds this lookup to one row per matching notification ID.
        OFFSET 0
    ) un
    JOIN notification n ON n.id = un.notification_id
    WHERE (cardinality($5::text[]) = 0 OR n.notification_event_type = ANY($5))
      AND (NOT $7::bool OR (
          n.notification_event_type IN ('channel_message_send', 'channel_mention', 'document_mention')
          AND COALESCE(n.metadata->>'threadId', n.metadata->>'thread_id') IS NULL
      ))
      AND (NOT $8::bool OR requested.entity_type <> 'channel' OR (
          n.notification_event_type = 'document_mention'
          OR (n.notification_event_type IN ('channel_message_send', 'channel_message_reply') AND (
              -- Mention stacks consume the mention, not its duplicate send/reply.
              EXISTS (
                  SELECT 1 FROM channel_scopes scope
                  WHERE scope.channel_id = n.event_item_id
                    AND scope.mentioned_message_id = COALESCE(n.metadata->>'messageId', n.metadata->>'message_id')
              )
              OR (n.notification_event_type = 'channel_message_send' AND NOT EXISTS (
                  SELECT 1 FROM channel_scopes scope
                  WHERE scope.channel_id = n.event_item_id AND scope.thread_id <> ''
                    AND scope.thread_id = COALESCE(n.metadata->>'messageId', n.metadata->>'message_id')
              ))
              OR (n.notification_event_type = 'channel_message_reply'
                  AND NULLIF(COALESCE(n.metadata->>'threadId', n.metadata->>'thread_id'), '') IS NULL)
          ))
          OR (n.notification_event_type = 'channel_mention' AND (
              COALESCE(n.metadata->>'threadId', n.metadata->>'thread_id') = ''
              OR (COALESCE(n.metadata->>'threadId', n.metadata->>'thread_id') IS NULL
                  AND COALESCE(n.metadata->>'messageId', n.metadata->>'message_id') = ''
                  AND EXISTS (SELECT 1 FROM channel_scopes scope
                      WHERE scope.channel_id = n.event_item_id AND scope.thread_id = ''))
          ))
      ))
    ORDER BY un.created_at DESC, un.notification_id DESC
    LIMIT $6
) matched
