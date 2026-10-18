-- Keep the successful request identity after removing its pending setup row.
-- Existing bindings without this evidence remain ineligible for create replay.
SET lock_timeout = '5s';
ALTER TABLE meta_messaging_conversation
    ADD COLUMN group_creation_subject text,
    ADD COLUMN group_creation_generation timestamptz;
