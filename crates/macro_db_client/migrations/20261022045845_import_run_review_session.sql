-- The agent session that presented a Notion import's review.
--
-- When the plan the review shows is ready, and when its write ends, the
-- import produces a system event for this session in the same transaction
-- as the run's transition. A deleted session clears it, so the run still
-- finishes; import_run holds one row per user and source, so the foreign
-- key needs no index.
--
-- Nullable, so code deployed before this change keeps working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN review_session_id UUID REFERENCES agent_session (id) ON DELETE SET NULL;
