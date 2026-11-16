-- Every existing row has a NULL parent, so both scans pass; validating takes
-- only SHARE UPDATE EXCLUSIVE, which blocks neither reads nor writes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action VALIDATE CONSTRAINT scheduled_action_parent_id_fkey;
ALTER TABLE scheduled_action VALIDATE CONSTRAINT scheduled_action_child_has_parent;
