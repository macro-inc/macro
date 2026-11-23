-- What a reply suggestion's card shows besides its words, read from its items
-- when a session writes it, so reading the feed reads nothing else: who the
-- person owes a reply and since when, and the start of its reply draft.
SET LOCAL lock_timeout = '5s';

ALTER TABLE suggestion_entity
    -- When the message the person hasn't answered came, and its sender's
    -- name; cleared when the suggestion is resolved.
    ADD COLUMN waiting_since timestamptz,
    ADD COLUMN waiting_from text,
    -- The start of the reply draft's plain text, when it has one.
    ADD COLUMN draft_preview text;
