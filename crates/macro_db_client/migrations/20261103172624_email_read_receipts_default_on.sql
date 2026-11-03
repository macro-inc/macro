-- Read receipts are on by default. Every existing row was set to FALSE by the
-- column's original default before anyone could choose, so they flip once.
ALTER TABLE email_settings ALTER COLUMN read_receipts_enabled SET DEFAULT TRUE;
UPDATE email_settings SET read_receipts_enabled = TRUE WHERE NOT read_receipts_enabled;
