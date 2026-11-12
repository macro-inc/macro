SET lock_timeout = '5s';

ALTER TABLE macro_user
    ADD COLUMN mailbox_handle_claimed_at TIMESTAMPTZ;

ALTER TABLE email_links
    DROP COLUMN IF EXISTS is_primary CASCADE;

ALTER TABLE email_links
    ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- Preserve the legacy primary mailbox for existing accounts. New external
-- links stay non-primary; a Rox link is explicitly marked primary by its writer.
UPDATE email_links
SET is_primary = true
WHERE provider = 'ROX'
   OR macro_id = 'macro|' || lower(email_address::text);
