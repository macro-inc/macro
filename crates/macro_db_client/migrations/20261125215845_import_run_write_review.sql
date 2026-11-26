-- The review whose write a workspace import run admitted. It is set in the
-- same statement that first moves a ready plan to importing, and cleared when
-- a new plan starts, so a failed write can be retried by that review alone
-- without guessing from other columns. NULL on runs that never wrote, and on
-- runs from before this column existed (which therefore cannot be retried).
--
-- A nullable column without a default is a catalog-only change.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run ADD COLUMN write_review_id UUID;
