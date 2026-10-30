-- Keeps comms_message_threads.activity_at in step with its root and replies,
-- then backfills it.
--
-- Writers take these tables in both orders: a root insert writes comms_messages
-- and then, from trg_initialize_comms_message_thread, comms_message_threads;
-- edits and thread deletes lock the thread row and then write comms_messages.
-- Whichever table this migration locks first, it can close a cycle while it
-- waits for the second. Both locks are taken back to back with a lock_timeout
-- below deadlock_timeout (1s on RDS), so in a cycle this migration gives up
-- before Postgres aborts a user's transaction, releases both, and retries.
-- Once both are held, no writer can interleave with the trigger install or the
-- backfill, and thread reads continue throughout.
SET LOCAL lock_timeout = '500ms';
DO $$
BEGIN
    FOR attempt IN 1..20 LOOP
        BEGIN
            LOCK TABLE comms_messages IN SHARE ROW EXCLUSIVE MODE;
            LOCK TABLE comms_message_threads IN EXCLUSIVE MODE;
            RETURN;
        EXCEPTION WHEN lock_not_available THEN
            PERFORM pg_sleep(0.2);
        END;
    END LOOP;
    RAISE EXCEPTION 'could not lock comms_messages and comms_message_threads';
END;
$$;

CREATE OR REPLACE FUNCTION initialize_comms_message_thread() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.thread_id IS NULL THEN
        INSERT INTO comms_message_threads (
            root_id, parent_entity_type, parent_entity_id, user_id,
            created_at, updated_at, activity_at
        )
        VALUES (
            NEW.id, NEW.parent_entity_type, NEW.parent_entity_id,
            NEW.sender_id, NEW.created_at, NEW.updated_at,
            CASE WHEN NEW.deleted_at IS NULL THEN NEW.updated_at END
        );
    END IF;
    RETURN NEW;
END;
$$;

-- One root's replies, not the caller's whole channel list. A deleted root
-- drops out of the activity index by clearing activity_at; thread.deleted_at
-- stays a separate flag.
CREATE FUNCTION recompute_comms_thread_activity(p_root uuid) RETURNS void
LANGUAGE sql AS $$
    UPDATE comms_message_threads t
    SET activity_at = CASE
        WHEN root.deleted_at IS NOT NULL THEN NULL
        ELSE GREATEST(
            root.updated_at,
            COALESCE((
                SELECT MAX(reply.updated_at)
                FROM comms_messages reply
                WHERE reply.thread_id = root.id
                  AND reply.deleted_at IS NULL
            ), root.updated_at)
        )
    END
    FROM comms_messages root
    WHERE root.id = p_root
      AND t.root_id = root.id
      AND root.thread_id IS NULL;
$$;

CREATE FUNCTION refresh_comms_thread_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- A root's thread row is created with its activity_at. A live reply can
        -- only raise its thread's activity, so bulk imports into one thread do
        -- not rescan every earlier reply. A NULL activity_at (deleted root)
        -- stays NULL.
        IF NEW.thread_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
            UPDATE comms_message_threads
            SET activity_at = NEW.updated_at
            WHERE root_id = NEW.thread_id
              AND activity_at < NEW.updated_at;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        PERFORM recompute_comms_thread_activity(COALESCE(OLD.thread_id, OLD.id));
        RETURN OLD;
    END IF;
    PERFORM recompute_comms_thread_activity(COALESCE(NEW.thread_id, NEW.id));
    IF OLD.thread_id IS DISTINCT FROM NEW.thread_id AND OLD.thread_id IS NOT NULL THEN
        PERFORM recompute_comms_thread_activity(OLD.thread_id);
    END IF;
    RETURN NEW;
END;
$$;

-- Name sorts after trg_initialize so a new root's thread row exists first.
CREATE TRIGGER trg_refresh_comms_thread_activity
AFTER INSERT OR DELETE OR UPDATE OF thread_id, updated_at, deleted_at ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION refresh_comms_thread_activity();

UPDATE comms_message_threads t
SET activity_at = computed.activity_at
FROM (
    SELECT
        root.id,
        CASE
            WHEN root.deleted_at IS NOT NULL THEN NULL
            ELSE GREATEST(
                root.updated_at,
                COALESCE(
                    MAX(reply.updated_at) FILTER (WHERE reply.deleted_at IS NULL),
                    root.updated_at
                )
            )
        END AS activity_at
    FROM comms_messages root
    LEFT JOIN comms_messages reply ON reply.thread_id = root.id
    WHERE root.thread_id IS NULL
    GROUP BY root.id
) computed
WHERE t.root_id = computed.id;
