-- Validate the kind check that 20261118174721 added NOT VALID, in its own
-- transaction. It takes a SHARE UPDATE EXCLUSIVE lock: reads and writes go on
-- meanwhile.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE email_sync_streams VALIDATE CONSTRAINT email_sync_streams_kind_check;
