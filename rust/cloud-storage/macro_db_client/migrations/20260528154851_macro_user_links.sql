-- Directed graph of capability delegations between macro_ids.
-- Used by multi-inbox to model "primary account A can read child account B's inbox"
-- without merging identities. Only capability='inbox' is implemented today; the column
-- leaves room for future delegations (e.g. 'send-as', 'view-only') without a re-migration.
CREATE TABLE IF NOT EXISTS macro_user_links (
    primary_macro_id TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    child_macro_id   TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    capability       TEXT NOT NULL,
    created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (primary_macro_id, child_macro_id, capability),
    CHECK (primary_macro_id <> child_macro_id)
);

-- Reverse lookup: "which primaries delegate from this child?"
CREATE INDEX IF NOT EXISTS macro_user_links_child_idx
    ON macro_user_links (child_macro_id, capability);
