SET LOCAL lock_timeout = '2s';

DROP INDEX password_item_entities_substring;
DROP INDEX password_totp_enrollments_nonretired;
CREATE INDEX password_totp_enrollments_cleanup ON password_totp_enrollments(cleanup_after) WHERE state<>'active';
DROP INDEX password_totp_enrollments_repeat_due;
DROP INDEX password_totp_enrollments_first_due;
DROP INDEX password_totp_enrollments_unstarted;
DROP INDEX password_totp_enrollments_active_scan;
DROP INDEX password_item_entities_cleanup_due;
DROP TABLE password_totp_cleanup_cursor;
DROP TABLE password_totp_cleanup_candidates;
ALTER TABLE password_totp_enrollments DROP COLUMN cleanup_retry_after;
