-- Validate the format check that 20261116193746 added NOT VALID, in its own
-- transaction. It takes a SHARE UPDATE EXCLUSIVE lock: reads and writes go on
-- meanwhile.
SET LOCAL lock_timeout = '2s';

ALTER TABLE password_import_activity VALIDATE CONSTRAINT password_import_activity_format_check;
