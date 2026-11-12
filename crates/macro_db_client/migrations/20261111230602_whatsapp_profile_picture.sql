-- What one linked account can see of a WhatsApp person's or group's profile
-- picture (preview size). Privacy is per viewer, so a picture is stored per
-- observing account; a chat shows the pictures its owner's account sees.
CREATE TABLE whatsapp_profile_picture (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    jid text NOT NULL CHECK (jid ~ '^[0-9]+@(s[.]whatsapp[.]net|lid)$' OR jid ~ '^[0-9-]+@g[.]us$'),
    -- due: never checked; staged: bytes waiting for DSS; ready: static file
    -- stored; none: not set; hidden: WhatsApp's privacy setting refuses this
    -- account; failed: repeated errors, checked again much later.
    state text NOT NULL CHECK (state IN ('due', 'staged', 'ready', 'none', 'hidden', 'failed')),
    -- WhatsApp's id of the picture the staged bytes or static file hold.
    picture_id text CHECK (octet_length(picture_id) <= 64),
    -- The only column the read path joins on; null shows initials.
    static_file_id uuid UNIQUE,
    staged bytea CHECK (octet_length(staged) <= 1048576),
    mime text CHECK (octet_length(mime) <= 64),
    checked_at timestamptz,
    -- When the next check (or, staged, DSS's import) is due.
    retry_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    CONSTRAINT whatsapp_profile_picture_ready_file CHECK (state <> 'ready' OR static_file_id IS NOT NULL),
    CONSTRAINT whatsapp_profile_picture_staged_bytes CHECK ((state = 'staged') = (staged IS NOT NULL AND mime IS NOT NULL)),
    PRIMARY KEY (account_id, jid)
);
CREATE INDEX whatsapp_profile_picture_due ON whatsapp_profile_picture(account_id, retry_at)
    WHERE state <> 'staged';
CREATE INDEX whatsapp_profile_picture_staged ON whatsapp_profile_picture(retry_at) WHERE state = 'staged';

-- Every picture query an account made in the last day: the pacing budget,
-- counted in Postgres so it survives the account moving between replicas.
CREATE TABLE whatsapp_picture_query (
    account_id uuid NOT NULL REFERENCES whatsapp_linked_account(id) ON DELETE CASCADE,
    queried_at timestamptz NOT NULL
);
CREATE INDEX whatsapp_picture_query_account ON whatsapp_picture_query(account_id, queried_at);

-- A static file a picture lets go of (replaced, removed, hidden, or the
-- account went away) is deleted by DSS like a released attachment.
CREATE FUNCTION whatsapp_profile_picture_release_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.static_file_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.static_file_id IS DISTINCT FROM OLD.static_file_id) THEN
        INSERT INTO external_chat_file_deletion (file_id) VALUES (OLD.static_file_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER whatsapp_profile_picture_release_file AFTER DELETE OR UPDATE OF static_file_id ON whatsapp_profile_picture
FOR EACH ROW EXECUTE FUNCTION whatsapp_profile_picture_release_file();
