-- email_attachments.thread_id copies its message's thread so attachments_by_thread_ids
-- reads one index on email_attachments instead of every message of every thread.
-- Triggers keep the copy equal for every writer: inserts and message_id changes
-- read it from the message, and moving a message moves its attachments.
-- 20261106191036 backfills existing rows; until then the column is NULL on them.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_attachments ADD COLUMN IF NOT EXISTS thread_id uuid;

CREATE OR REPLACE FUNCTION email_attachments_set_thread_id() RETURNS TRIGGER AS $$
BEGIN
    -- With message_id unchanged, only the backfill and the move trigger write
    -- thread_id, and both write the message's. Any other update keeps it,
    -- filling it on a row the backfill has not reached yet.
    IF TG_OP = 'UPDATE' AND NEW.message_id = OLD.message_id THEN
        IF NEW.thread_id IS NULL THEN
            SELECT thread_id INTO NEW.thread_id FROM email_messages WHERE id = NEW.message_id;
        END IF;
        RETURN NEW;
    END IF;

    -- A concurrent move cannot see this uncommitted row, so lock the message:
    -- a move in flight finishes first, and the next one waits for this commit.
    SELECT thread_id INTO NEW.thread_id FROM email_messages WHERE id = NEW.message_id FOR SHARE;
    IF NOT FOUND THEN
        -- Raised here because the NOT NULL check runs before the foreign key
        -- check, and callers retry foreign key violations but not NOT NULL ones.
        RAISE EXCEPTION 'insert or update on table "email_attachments" violates foreign key constraint "email_attachments_message_id_fkey"'
            USING ERRCODE = 'foreign_key_violation',
                  CONSTRAINT = 'email_attachments_message_id_fkey',
                  TABLE = 'email_attachments',
                  DETAIL = format('Key (message_id)=(%s) is not present in table "email_messages".', NEW.message_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER email_attachments_set_thread_id
BEFORE INSERT OR UPDATE ON email_attachments
FOR EACH ROW EXECUTE FUNCTION email_attachments_set_thread_id();

CREATE OR REPLACE FUNCTION email_messages_move_attachments() RETURNS TRIGGER AS $$
BEGIN
    UPDATE email_attachments SET thread_id = NEW.thread_id WHERE message_id = NEW.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER email_messages_move_attachments
AFTER UPDATE OF thread_id ON email_messages
FOR EACH ROW WHEN (OLD.thread_id IS DISTINCT FROM NEW.thread_id)
EXECUTE FUNCTION email_messages_move_attachments();
