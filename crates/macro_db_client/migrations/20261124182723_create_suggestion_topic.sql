-- A topic a person's suggestions are grouped under in For you: one thing in
-- their work, such as a customer or an event, named by the generation
-- sessions. `key` names it across nights, as `suggestion.dedup_key` does a
-- suggestion, so the same topic keeps its group; a session naming the same
-- key again updates this row. `reason` is one line on why it matters now, if
-- there is one, with the item that states it: whoever can't open that item
-- isn't shown the line. A topic no suggestion has is never shown; a session names few
-- (the code caps them per generation), and they go with their person.

-- The new table's foreign key locks "User", and the column and its foreign
-- key lock suggestion, until this file commits; don't queue behind a long
-- transaction holding them.
SET LOCAL lock_timeout = '5s';

CREATE TABLE suggestion_topic (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    key text NOT NULL,
    name text NOT NULL,
    reason text,
    reason_entity_type text,
    reason_entity_id text,
    -- A part of the item, such as one message of a channel.
    reason_part_id text,
    -- The session and generation that last named it.
    session_id uuid NOT NULL,
    generation_id uuid NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, key),
    CONSTRAINT suggestion_topic_reason_source CHECK (
        num_nonnulls(reason, reason_entity_type, reason_entity_id) IN (0, 3)
        AND (reason IS NOT NULL OR reason_part_id IS NULL)
    )
);

-- How many topics a generation named.
CREATE INDEX suggestion_topic_generation_idx ON suggestion_topic (generation_id);

-- A suggestion has one topic or none. Nullable, with no default, so it
-- changes only the catalog.
ALTER TABLE suggestion ADD COLUMN topic_key text;
ALTER TABLE suggestion ADD CONSTRAINT suggestion_topic_fkey
    FOREIGN KEY (user_id, topic_key) REFERENCES suggestion_topic (user_id, key) NOT VALID;
