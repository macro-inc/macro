SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE public.email_projection_outbox_sequence;

-- Adding a volatile nextval default with the column would rewrite the table.
-- Existing rows stay NULL; only future inserts receive the sequence default.
ALTER TABLE public.email_projection_outbox
    ADD COLUMN seq bigint,
    ADD COLUMN parked_at timestamptz,
    ADD COLUMN blocked_until timestamptz;
ALTER TABLE public.email_projection_outbox
    ALTER COLUMN seq SET DEFAULT nextval('public.email_projection_outbox_sequence');
ALTER SEQUENCE public.email_projection_outbox_sequence
    OWNED BY public.email_projection_outbox.seq;
