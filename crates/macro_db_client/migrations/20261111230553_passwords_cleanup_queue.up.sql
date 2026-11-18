SET LOCAL lock_timeout = '2s';

-- All relations below belong to this unshipped vault feature. Queue membership
-- is retryable discovery state; enrollment identities remain permanently journaled.
ALTER TABLE password_totp_enrollments ADD COLUMN cleanup_retry_after TIMESTAMPTZ NOT NULL DEFAULT '-infinity';
CREATE TABLE password_totp_cleanup_candidates (
    team_id UUID NOT NULL,
    key_id UUID NOT NULL,
    retry_after TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    PRIMARY KEY(team_id,key_id),
    FOREIGN KEY(team_id,key_id) REFERENCES password_totp_enrollments(team_id,key_id) ON DELETE CASCADE
);
CREATE INDEX password_totp_cleanup_candidates_due ON password_totp_cleanup_candidates(retry_after,team_id,key_id);
CREATE TABLE password_totp_cleanup_cursor (
    singleton BOOLEAN PRIMARY KEY CHECK(singleton),
    team_id UUID,
    key_id UUID,
    CHECK((team_id IS NULL) = (key_id IS NULL))
);
INSERT INTO password_totp_cleanup_cursor(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE INDEX password_item_entities_cleanup_due ON password_item_entities(cleanup_due_at NULLS FIRST,team_id,id)
    WHERE deleting AND deleted_at IS NULL;
CREATE INDEX password_totp_enrollments_active_scan ON password_totp_enrollments(team_id,key_id) WHERE state='active';
CREATE INDEX password_totp_enrollments_unstarted ON password_totp_enrollments(cleanup_retry_after,team_id,key_id)
    WHERE state<>'active' AND cleanup_started_at IS NULL AND erased_at IS NULL;
CREATE INDEX password_totp_enrollments_first_due ON password_totp_enrollments(GREATEST(cleanup_after,cleanup_retry_after),team_id,key_id)
    WHERE state<>'active' AND cleanup_started_at IS NOT NULL AND erased_at IS NULL;
CREATE INDEX password_totp_enrollments_repeat_due ON password_totp_enrollments(GREATEST(cleanup_after,cleanup_retry_after),team_id,key_id)
    WHERE state<>'active' AND erased_at IS NOT NULL;
DROP INDEX password_totp_enrollments_cleanup;
-- Permanent history need not be read when retiring currently live generations.
CREATE INDEX password_totp_enrollments_nonretired ON password_totp_enrollments(team_id,item_id)
    WHERE state<>'retired';
-- Tenant scope and literal substring matching share the same GIN access path.
CREATE INDEX password_item_entities_substring ON password_item_entities USING gin
    (team_id, (lower(metadata->>'name') || ' ' || lower(COALESCE(metadata->>'url',''))) gin_trgm_ops)
    WHERE deleted_at IS NULL AND NOT deleting;
