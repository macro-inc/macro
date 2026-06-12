-- A link is primary when its email_address is the owning user's own
-- macro_id email (macro_id is the string 'macro|{email}', lowercased).
-- Non-primary links are connected secondary mailboxes. Stored generated
-- so the flag can never drift from the columns that define it.
ALTER TABLE email_links
    ADD COLUMN is_primary boolean NOT NULL
    GENERATED ALWAYS AS (macro_id = 'macro|' || lower(email_address::text)) STORED;
