-- Why the calendar's latest sync attempt failed, beside `last_sync_error`:
-- booking availability serves a transient failure's stored events for a
-- bounded time and refuses a permanent or reauthorization one. Meaningful
-- only while `last_sync_error` is set. Nullable, so code deployed before this
-- change keeps writing failures without it; readers treat a failure with no
-- kind as permanent.
SET LOCAL lock_timeout = '5s';

ALTER TABLE calendars ADD COLUMN last_sync_error_kind text;

-- Every existing row is NULL, so the constraint needs no validating scan.
ALTER TABLE calendars
    ADD CONSTRAINT calendars_last_sync_error_kind_check
    CHECK (last_sync_error_kind IN ('transient', 'permanent', 'reauth_required'))
    NOT VALID;
