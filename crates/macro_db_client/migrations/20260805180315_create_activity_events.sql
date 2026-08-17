-- One append-only table of activity facts: a principal did something to an
-- entity at a time. Every activity surface is a query over this table; no
-- derived tables. See the activity crate for the fact vocabulary.
CREATE TABLE activity_events (
    -- uuidv5(source event id, ordinal): one broker event may yield several
    -- facts; replays re-derive the same ids, making inserts idempotent.
    id             UUID PRIMARY KEY,
    -- Who mechanically acted, as a prefixed principal string (macro|…, bot|…).
    actor_id       TEXT NOT NULL,
    -- Whose activity this is: on_behalf_of ?? actor, resolved at ingestion.
    subject_id     TEXT NOT NULL,
    action         TEXT NOT NULL,
    -- Per-action payload; NULL for payload-free actions.
    action_payload JSONB,
    entity_type    TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL
);

-- id doubles as the keyset-pagination tiebreaker in both indexes.
CREATE INDEX idx_activity_events_subject
    ON activity_events (subject_id, occurred_at DESC, id DESC);
CREATE INDEX idx_activity_events_entity
    ON activity_events (entity_type, entity_id, occurred_at DESC, id DESC);
