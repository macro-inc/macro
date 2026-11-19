\pset pager off
SET default_transaction_read_only=on; SET statement_timeout='60s';
SELECT parent_entity_id AS channel_id FROM comms_messages WHERE parent_entity_type='channel' GROUP BY parent_entity_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT created_at AS cursor_ts,id AS cursor_id FROM comms_messages WHERE parent_entity_type='channel' AND parent_entity_id=:'channel_id' AND thread_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET 32000 \gset

WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) < (NULL, NULL::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(NULL::timestamptz, 'infinity'::timestamptz), COALESCE(NULL::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_latest_1' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) < (NULL, NULL::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 50), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(NULL::timestamptz, 'infinity'::timestamptz), COALESCE(NULL::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 50), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_latest_50' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) < (NULL, NULL::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 100), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(NULL::timestamptz, 'infinity'::timestamptz), COALESCE(NULL::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 100), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_latest_100' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) < (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(:'cursor_ts'::timestamptz::timestamptz, 'infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_deep_1' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) < (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 50), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(:'cursor_ts'::timestamptz::timestamptz, 'infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 50), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_deep_50' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) < (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 100), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) < (COALESCE(:'cursor_ts'::timestamptz::timestamptz, 'infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT 100), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'older_deep_100' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) > (NULL, NULL::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 1), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(NULL::timestamptz, '-infinity'::timestamptz), COALESCE(NULL::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 1), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_latest_1' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) > (NULL, NULL::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 50), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(NULL::timestamptz, '-infinity'::timestamptz), COALESCE(NULL::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 50), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_latest_50' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (NULL::timestamptz IS NULL OR (m.created_at, m.id) > (NULL, NULL::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 100), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(NULL::timestamptz, '-infinity'::timestamptz), COALESCE(NULL::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 100), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_latest_100' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) > (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 1), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(:'cursor_ts'::timestamptz::timestamptz, '-infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 1), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_deep_1' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) > (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 50), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(:'cursor_ts'::timestamptz::timestamptz, '-infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 50), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_deep_50' AS selection, count(*) AS different_rows FROM changed;
WITH old_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (:'cursor_ts'::timestamptz::timestamptz IS NULL OR (m.created_at, m.id) > (:'cursor_ts'::timestamptz, :'cursor_id'::uuid::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 100), new_page AS (SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = :'channel_id'
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR false)
                AND (m.deleted_at IS NULL OR 'channel' = 'document' OR (false AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND (NULL::uuid[] IS NULL OR m.id = ANY(NULL))
                AND (NULL::bool IS NULL OR (t.anchor IS NOT NULL) = NULL)
                AND ((NULL::timestamptz IS NULL AND NULL::timestamptz IS NULL)
                    OR ((NULL::timestamptz IS NULL OR m.created_at >= NULL) AND (NULL::timestamptz IS NULL OR m.created_at < NULL))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND (NULL::timestamptz IS NULL OR r.created_at >= NULL) AND (NULL::timestamptz IS NULL OR r.created_at < NULL)))
                AND (m.created_at, m.id) > (COALESCE(:'cursor_ts'::timestamptz::timestamptz, '-infinity'::timestamptz), COALESCE(:'cursor_id'::uuid::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT 100), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT 'newer_deep_100' AS selection, count(*) AS different_rows FROM changed;