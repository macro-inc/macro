-- Channel thread pages sort by GREATEST(root.updated_at, latest live reply
-- updated_at). That value is computed per root, so the page reads every thread
-- in every channel the caller belongs to. Store it on the thread row the root
-- already owns. Nullable so the service that is deployed during this migration
-- can keep inserting thread rows without naming the column.

ALTER TABLE comms_message_threads
    ADD COLUMN activity_at timestamptz;

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
DECLARE
    affected uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected := COALESCE(OLD.thread_id, OLD.id);
    ELSE
        affected := COALESCE(NEW.thread_id, NEW.id);
    END IF;
    PERFORM recompute_comms_thread_activity(affected);
    IF TG_OP = 'UPDATE' AND OLD.thread_id IS DISTINCT FROM NEW.thread_id AND OLD.thread_id IS NOT NULL THEN
        PERFORM recompute_comms_thread_activity(OLD.thread_id);
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Name sorts after trg_initialize so a new root's thread row exists first.
CREATE TRIGGER trg_refresh_comms_thread_activity
AFTER INSERT OR UPDATE OR DELETE ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION refresh_comms_thread_activity();
