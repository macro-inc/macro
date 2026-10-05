-- Gmail send-as aliases: alternative "From" addresses a user can send email as.
-- Each link (inbox) can have multiple send-as aliases configured in Gmail.
-- The primary inbox address is implicitly available and not stored here.

CREATE TABLE public.email_send_as_aliases (
    id                      uuid                                   NOT NULL,
    link_id                 uuid                                   NOT NULL,
    -- The email address this alias sends as (e.g. support@company.com)
    send_as_email           character varying(320)                 NOT NULL,
    -- Display name shown in the From field
    display_name            character varying(255),
    -- Reply-to address if different from send_as_email
    reply_to_address        character varying(320),
    -- Gmail-assigned signature HTML (sanitized on ingest)
    signature_html          text,
    -- Whether this alias is the default send-as for the inbox
    is_default              boolean                  DEFAULT false NOT NULL,
    -- Whether this alias has been verified by Gmail
    is_verified             boolean                  DEFAULT false NOT NULL,
    -- Whether this alias can use Gmail's treatment of it as the primary
    is_primary              boolean                  DEFAULT false NOT NULL,
    created_at              timestamp with time zone DEFAULT now() NOT NULL,
    updated_at              timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT email_send_as_aliases_pkey PRIMARY KEY (id)
);

-- Each send-as email must be unique per link
CREATE UNIQUE INDEX idx_email_send_as_aliases_link_email
    ON public.email_send_as_aliases (link_id, lower(send_as_email));

-- Fast lookup by link for loading all aliases
CREATE INDEX idx_email_send_as_aliases_link_id
    ON public.email_send_as_aliases (link_id);

-- FK to email_links
ALTER TABLE ONLY public.email_send_as_aliases
    ADD CONSTRAINT email_send_as_aliases_link_id_fkey
    FOREIGN KEY (link_id) REFERENCES public.email_links (id) ON DELETE CASCADE;
