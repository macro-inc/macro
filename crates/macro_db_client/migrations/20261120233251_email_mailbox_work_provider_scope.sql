SET LOCAL lock_timeout = '5s';

-- The constant fast default preserves pre-existing Outlook work without a
-- table rewrite. The trigger fills the authoritative provider for old writers
-- too, including Gmail cleanup work and earlier IMAP preview snapshots.
ALTER TABLE public.email_sync_streams
    ADD COLUMN provider public.email_user_provider_enum NOT NULL DEFAULT 'OUTLOOK';
ALTER TABLE public.email_message_reconciliation
    ADD COLUMN provider public.email_user_provider_enum NOT NULL DEFAULT 'OUTLOOK';

CREATE FUNCTION public.email_set_mailbox_work_provider()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Provider is immutable for an existing link. Existing link-id foreign
    -- keys retain parent ownership; legacy writers need only routing metadata.
    SELECT l.provider
    INTO NEW.provider
    FROM public.email_links l
    WHERE l.id = NEW.link_id;

    IF NOT FOUND THEN
        RAISE foreign_key_violation USING MESSAGE = 'mailbox link is missing';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER email_sync_streams_derive_provider
    BEFORE INSERT OR UPDATE OF link_id, provider
    ON public.email_sync_streams
    FOR EACH ROW
    EXECUTE FUNCTION public.email_set_mailbox_work_provider();

CREATE TRIGGER email_message_reconciliation_derive_provider
    BEFORE INSERT OR UPDATE OF link_id, provider
    ON public.email_message_reconciliation
    FOR EACH ROW
    EXECUTE FUNCTION public.email_set_mailbox_work_provider();
