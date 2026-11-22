SET LOCAL lock_timeout = '5s';

-- Acquire child locks before the parent, in the same order on every deploy.
-- Do not hold the parent lock while waiting for either child table's DDL lock.
LOCK TABLE
    public.email_message_reconciliation,
    public.email_sync_streams,
    public.email_links
IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.email_links
    ADD CONSTRAINT email_links_id_provider_queue_key
    UNIQUE USING INDEX email_links_id_provider_queue_key;

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
    -- Lock before reading so a parent provider change cannot pass this insert.
    -- The composite foreign keys handle existing children and snapshot races.
    SELECT l.provider
    INTO NEW.provider
    FROM public.email_links l
    WHERE l.id = NEW.link_id
    FOR KEY SHARE;

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

-- New writes are checked immediately. Validate old rows separately after the
-- backfill, without retaining this migration's exclusive DDL locks for a scan.
ALTER TABLE public.email_sync_streams
    ADD CONSTRAINT email_sync_streams_link_provider_fkey
    FOREIGN KEY (link_id, provider)
    REFERENCES public.email_links (id, provider)
    ON DELETE CASCADE
    ON UPDATE CASCADE
    NOT VALID;

ALTER TABLE public.email_message_reconciliation
    ADD CONSTRAINT email_message_reconciliation_link_provider_fkey
    FOREIGN KEY (link_id, provider)
    REFERENCES public.email_links (id, provider)
    ON DELETE CASCADE
    ON UPDATE CASCADE
    NOT VALID;
