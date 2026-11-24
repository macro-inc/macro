SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5s';

-- Writers take the command before its targets. Seal that parent-first order
-- while installing both triggers and filling the existing in-flight backlog.
-- Plain command reads remain available; target reads and writes wait through
-- this transaction. Lock acquisition and each statement fail fast.
LOCK TABLE email_mailbox_commands IN EXCLUSIVE MODE;

-- These are index facts, not a second authority. Terminal receipts stay NULL
-- until a later ordinary transition touches them; no history backfill is needed.
ALTER TABLE email_mailbox_command_targets
    ADD COLUMN parent_link_id UUID,
    ADD COLUMN parent_generation BIGINT,
    ADD COLUMN parent_accepted_order BIGINT,
    ADD COLUMN parent_unfinished BOOLEAN;

CREATE FUNCTION public.email_derive_mailbox_command_target() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT command.link_id,command.generation,command.accepted_order,
        command.status IN ('pending','running','confirming')
    INTO NEW.parent_link_id,NEW.parent_generation,
        NEW.parent_accepted_order,NEW.parent_unfinished
    FROM email_mailbox_commands command
    WHERE command.id=NEW.command_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'mailbox command target has no parent'
            USING ERRCODE='23503';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER email_mailbox_command_targets_derive_facts
    BEFORE INSERT ON email_mailbox_command_targets
    FOR EACH ROW EXECUTE FUNCTION public.email_derive_mailbox_command_target();

CREATE FUNCTION public.email_follow_mailbox_command_target_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE email_mailbox_command_targets target
    SET parent_link_id=NEW.link_id,
        parent_generation=NEW.generation,
        parent_accepted_order=NEW.accepted_order,
        parent_unfinished=NEW.status IN ('pending','running','confirming')
    WHERE target.command_id=NEW.id
        AND (target.parent_link_id,target.parent_generation,
             target.parent_accepted_order,target.parent_unfinished)
            IS DISTINCT FROM
            (NEW.link_id,NEW.generation,NEW.accepted_order,
             NEW.status IN ('pending','running','confirming'));
    RETURN NULL;
END;
$$;
-- Claiming or confirming a command doesn't change whether it is unfinished.
-- Avoid target rewrites/locks on those frequent nonterminal transitions.
CREATE TRIGGER email_mailbox_command_targets_follow_parent
    AFTER UPDATE OF status,generation,link_id ON email_mailbox_commands
    FOR EACH ROW WHEN (
        NEW.link_id IS DISTINCT FROM OLD.link_id
        OR NEW.generation IS DISTINCT FROM OLD.generation
        OR (NEW.status IN ('pending','running','confirming'))
            IS DISTINCT FROM (OLD.status IN ('pending','running','confirming'))
    ) EXECUTE FUNCTION public.email_follow_mailbox_command_target_parent();

-- Fill only the in-flight backlog, after old-writer-compatible triggers exist.
-- The primary-key prefix narrows target writes to these parent ids; retained
-- terminal history is untouched. The parent lock keeps this snapshot stable.
UPDATE email_mailbox_command_targets target
SET (parent_link_id,parent_generation,parent_accepted_order,parent_unfinished) = (
    SELECT command.link_id,command.generation,command.accepted_order,true
    FROM email_mailbox_commands command WHERE command.id=target.command_id
)
WHERE target.command_id=ANY(ARRAY(
    SELECT id FROM email_mailbox_commands
    WHERE status IN ('pending','running','confirming')
));
