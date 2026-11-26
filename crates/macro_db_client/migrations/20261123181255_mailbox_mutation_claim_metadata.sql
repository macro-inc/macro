SET LOCAL lock_timeout = '5s';

-- Nullable routing preserves old rows; bounded NULL-provider claim lanes drain
-- them without a table rewrite or an unbounded rollout UPDATE.
ALTER TABLE email_mailbox_drafts
    ADD COLUMN provider email_user_provider_enum,
    ADD COLUMN parked_at TIMESTAMPTZ,
    ADD COLUMN blocked_until TIMESTAMPTZ;
ALTER TABLE email_mailbox_commands
    ADD COLUMN provider email_user_provider_enum,
    ADD COLUMN parked_at TIMESTAMPTZ,
    ADD COLUMN blocked_until TIMESTAMPTZ;

CREATE TRIGGER email_mailbox_drafts_derive_provider
    BEFORE INSERT OR UPDATE OF link_id, provider ON email_mailbox_drafts
    FOR EACH ROW EXECUTE FUNCTION public.email_set_mailbox_work_provider();
CREATE TRIGGER email_mailbox_commands_derive_provider
    BEFORE INSERT OR UPDATE OF link_id, provider ON email_mailbox_commands
    FOR EACH ROW EXECUTE FUNCTION public.email_set_mailbox_work_provider();

-- Old writers do not know the local parking fields. An actual business edit or
-- retry must re-arm work without changing its real deadline or live lease.
CREATE FUNCTION public.email_rearm_mailbox_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.link_id IS DISTINCT FROM OLD.link_id
        OR NEW.generation IS DISTINCT FROM OLD.generation
        OR NEW.revision IS DISTINCT FROM OLD.revision
        OR NEW.desired_content IS DISTINCT FROM OLD.desired_content
        OR NEW.delete_requested IS DISTINCT FROM OLD.delete_requested
        OR NEW.state IS DISTINCT FROM OLD.state
        OR NEW.checkpoint IS DISTINCT FROM OLD.checkpoint
        OR NEW.available_at IS DISTINCT FROM OLD.available_at THEN
        NEW.parked_at := NULL;
        NEW.blocked_until := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER email_mailbox_drafts_rearm
    BEFORE UPDATE OF link_id, generation, revision, desired_content,
        delete_requested, state, checkpoint, available_at ON email_mailbox_drafts
    FOR EACH ROW EXECUTE FUNCTION public.email_rearm_mailbox_draft();

CREATE FUNCTION public.email_rearm_mailbox_command() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.link_id IS DISTINCT FROM OLD.link_id
        OR NEW.generation IS DISTINCT FROM OLD.generation
        OR NEW.intent IS DISTINCT FROM OLD.intent
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.available_at IS DISTINCT FROM OLD.available_at THEN
        NEW.parked_at := NULL;
        NEW.blocked_until := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER email_mailbox_commands_rearm
    BEFORE UPDATE OF link_id, generation, intent, status, available_at
    ON email_mailbox_commands
    FOR EACH ROW EXECUTE FUNCTION public.email_rearm_mailbox_command();

-- Schedule mutators serialize on the parent message before their schedule row,
-- as do draft settlement/start-delivery. This wake keeps that existing order;
-- no parent mailbox or message lock is introduced by the trigger.
CREATE FUNCTION public.email_rearm_scheduled_mailbox_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE email_mailbox_drafts SET parked_at = NULL, blocked_until = NULL
        WHERE message_id = OLD.message_id AND state IN ('pending','running','synced')
            AND (parked_at IS NOT NULL OR blocked_until IS NOT NULL);
        RETURN OLD;
    END IF;
    UPDATE email_mailbox_drafts SET parked_at = NULL, blocked_until = NULL
    WHERE message_id = NEW.message_id AND state IN ('pending','running','synced')
        AND (parked_at IS NOT NULL OR blocked_until IS NOT NULL);
    RETURN NEW;
END;
$$;
CREATE TRIGGER email_scheduled_messages_rearm_draft
    AFTER INSERT OR UPDATE OF send_time, processing, sent OR DELETE
    ON email_scheduled_messages
    FOR EACH ROW EXECUTE FUNCTION public.email_rearm_scheduled_mailbox_draft();
