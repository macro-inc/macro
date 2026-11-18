-- When a mail folder stream's current delta round started: the claim of the
-- round's first page, written by `commit_page` beside `reader_revision` and
-- copied by `rebind_work`. A folder's live pass lists mail received from
-- shortly before it, so a pass opened at a later page of an import round
-- still covers the whole round. Nullable without a default, so no row is
-- rewritten; the short lock timeout keeps claims from queueing behind it.
SET LOCAL lock_timeout = '1s';

ALTER TABLE email_sync_streams ADD COLUMN round_started_at timestamptz;
