-- Previews of the web pages a channel message links to, unfurled after the
-- message is posted or edited, in the order its text links them. Clients
-- render them with the message, so a card has its height when it mounts.
-- The foreign key briefly locks comms_messages; fail fast instead of queueing
-- writes behind a long transaction.
SET LOCAL lock_timeout = '2s';

CREATE TABLE public.comms_message_link_previews
(
    message_id  uuid                                   NOT NULL
        REFERENCES public.comms_messages (id) ON DELETE CASCADE,
    position    smallint                               NOT NULL,
    url         text                                   NOT NULL,
    title       text                                   NOT NULL,
    description text,
    image_url   text,
    favicon_url text,
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (message_id, position)
);
