-- Every existing row passed the narrower check this one replaced. Validating
-- takes only SHARE UPDATE EXCLUSIVE, which blocks neither reads nor writes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action VALIDATE CONSTRAINT scheduled_action_supported_triggers_check;
