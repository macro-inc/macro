SET LOCAL lock_timeout = '5s';

-- Use the existing per-draft write to route legacy rows when they change.
-- Unchanged drafts remain eligible for the bounded legacy claim window.
CREATE OR REPLACE FUNCTION public.email_rearm_mailbox_draft() RETURNS trigger
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
        IF NEW.provider IS NULL THEN
            SELECT l.provider INTO NEW.provider
            FROM public.email_links l
            WHERE l.id = NEW.link_id;
        END IF;
        NEW.parked_at := NULL;
        NEW.blocked_until := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- A schedule change already owns the message and schedule row. Keep the same
-- lock order and let the draft provider trigger derive routing on this write.
CREATE OR REPLACE FUNCTION public.email_rearm_scheduled_mailbox_draft() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    draft_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.send_time, NEW.processing, NEW.sent)
            IS NOT DISTINCT FROM (OLD.send_time, OLD.processing, OLD.sent) THEN
            RETURN NULL;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        draft_id := OLD.message_id;
    ELSE
        draft_id := NEW.message_id;
    END IF;

    -- A mailbox cascade can delete the schedule after its parent link.
    UPDATE public.email_mailbox_drafts d
    SET provider = d.provider, parked_at = NULL, blocked_until = NULL
    FROM public.email_links l
    WHERE d.message_id = draft_id AND l.id = d.link_id
        AND d.state IN ('pending', 'running', 'synced')
        AND (d.provider IS NULL OR d.parked_at IS NOT NULL OR d.blocked_until IS NOT NULL);
    RETURN NULL;
END;
$$;
