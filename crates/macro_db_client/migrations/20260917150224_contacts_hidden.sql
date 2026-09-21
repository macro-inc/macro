-- Per-owner suppression of a contact suggestion.
--
-- `contacts_connections` is an undirected, canonically ordered edge table that
-- inbox sync re-upserts on every message, so deleting an edge does not stick
-- and a flag on it would hide the person for both parties. A separate,
-- directed table records that `owner` no longer wants `contact` suggested
-- (e.g. a typo'd address learned from a bounced email); reads anti-join it
-- and replayed upserts leave it alone.
CREATE TABLE contacts_hidden (
    owner      TEXT NOT NULL,
    contact    TEXT NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, contact)
);
