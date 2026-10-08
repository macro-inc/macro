-- Earlier normalizers could omit malformed masters or instances while marking
-- coverage complete, including calendars with no retained source rows. Require
-- a strict snapshot once for every existing calendar before team activation.
-- Preserve existing sync state here so old workers can continue incremental
-- polling. A strict worker clears that state when it observes version 0 during
-- calendar upsert, then certifies only a successful full snapshot.
ALTER TABLE calendars
    ADD COLUMN snapshot_normalization_version integer NOT NULL DEFAULT 0;

-- A worker that predates strict normalization cannot retain a newer worker's
-- certification while advancing its own snapshot. The strict worker restores
-- version 1 in a separate statement inside the same fenced transaction.
CREATE FUNCTION calendar_invalidate_snapshot_normalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.snapshot_normalization_version := 0;
    RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_invalidate_snapshot_normalization
BEFORE UPDATE OF sync_token, synced_at,
    materialized_starts_at, materialized_ends_at,
    materialized_start_date, materialized_end_date
ON calendars
FOR EACH ROW
WHEN (
    OLD.sync_token IS DISTINCT FROM NEW.sync_token
    OR OLD.synced_at IS DISTINCT FROM NEW.synced_at
    OR OLD.materialized_starts_at IS DISTINCT FROM NEW.materialized_starts_at
    OR OLD.materialized_ends_at IS DISTINCT FROM NEW.materialized_ends_at
    OR OLD.materialized_start_date IS DISTINCT FROM NEW.materialized_start_date
    OR OLD.materialized_end_date IS DISTINCT FROM NEW.materialized_end_date
)
EXECUTE FUNCTION calendar_invalidate_snapshot_normalization();
