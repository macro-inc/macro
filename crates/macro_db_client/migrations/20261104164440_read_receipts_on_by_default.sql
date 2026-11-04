-- Open tracking is on by default per inbox.
ALTER TABLE email_settings
    ALTER COLUMN read_receipts_enabled SET DEFAULT TRUE;

-- The launch migration wrote FALSE to every row before anyone could choose a
-- value, so no stored FALSE is a user's choice yet.
UPDATE email_settings
SET read_receipts_enabled = TRUE
WHERE read_receipts_enabled = FALSE;
