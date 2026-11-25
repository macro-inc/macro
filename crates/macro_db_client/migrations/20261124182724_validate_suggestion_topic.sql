-- Validate the foreign key added NOT VALID in 20261124182723, in its own
-- transaction so that file's exclusive lock isn't held through the scan. It
-- takes a SHARE UPDATE EXCLUSIVE lock: reads and writes go on meanwhile.
SET LOCAL lock_timeout = '5s';

ALTER TABLE suggestion VALIDATE CONSTRAINT suggestion_topic_fkey;
