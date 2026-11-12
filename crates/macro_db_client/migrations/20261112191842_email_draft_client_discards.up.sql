SET LOCAL lock_timeout = '2s';

-- A discarded draft's client handle stays retired.
--
-- Deleting a draft cascades its email_draft_client_ids binding away, and a
-- save for an unbound handle mints a new draft. A save the composer sent
-- before the discard, arriving after it, therefore brought the draft back.
-- The discard records the handle here in its own transaction, and a save that
-- would mint a row for a recorded handle is refused instead.
CREATE TABLE email_draft_client_discards (
    link_id      uuid NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    client_id    uuid NOT NULL,
    discarded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, client_id)
);
