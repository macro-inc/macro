-- Read receipts are on by default. An existing FALSE is the old column default
-- rather than a choice when the row was never updated (updated_at still equals
-- created_at, which covers inboxes connected after the column arrived) or when
-- its last update predates the column (migration 20261022224928). Those rows
-- flip to TRUE. A row updated after the column existed is left alone: it may be
-- a deliberate disable, and a false negative only keeps an inbox off until its
-- owner turns the switch on.
ALTER TABLE email_settings ALTER COLUMN read_receipts_enabled SET DEFAULT TRUE;
UPDATE email_settings
SET read_receipts_enabled = TRUE
WHERE NOT read_receipts_enabled
  AND (
    updated_at = created_at
    OR updated_at <= (
      SELECT installed_on FROM _sqlx_migrations WHERE version = 20261022224928
    )
  );
