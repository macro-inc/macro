-- no-transaction

-- Copy each existing recipient row's entity from its notification. Batches
-- walk the primary key and commit on their own, so no batch holds row locks
-- for long and a rerun only rewrites the same values. Each batch updates an
-- explicit list of keys: a key range lets the loop's reused plan merge-join the
-- whole notification table on every batch. Run before the indexes are built
-- so the updates don't also maintain them.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 5000;
    last_user_id text := '';
    last_notification_id uuid := '00000000-0000-0000-0000-000000000000';
    user_ids text[];
    notification_ids uuid[];
BEGIN
    LOOP
        SELECT array_agg(batch.user_id ORDER BY batch.user_id, batch.notification_id),
               array_agg(batch.notification_id ORDER BY batch.user_id, batch.notification_id)
        INTO user_ids, notification_ids
        FROM (
            SELECT user_id, notification_id
            FROM user_notification
            WHERE (user_id, notification_id) > (last_user_id, last_notification_id)
            ORDER BY user_id, notification_id
            LIMIT batch_size
        ) batch;
        EXIT WHEN user_ids IS NULL;

        UPDATE user_notification un
        SET event_item_type = n.event_item_type,
            event_item_id = n.event_item_id,
            notification_event_type = n.notification_event_type
        FROM unnest(user_ids, notification_ids) AS batch(user_id, notification_id)
        JOIN notification n ON n.id = batch.notification_id
        WHERE un.user_id = batch.user_id
          AND un.notification_id = batch.notification_id;
        COMMIT;

        last_user_id := user_ids[cardinality(user_ids)];
        last_notification_id := notification_ids[cardinality(notification_ids)];
    END LOOP;
END
$$;
