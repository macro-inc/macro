-- Existing permission rows remain unshared; historical grants are reconciled separately.
ALTER TABLE "SharePermission"
    ADD COLUMN team_share_access_level "AccessLevel",
    ADD COLUMN team_share_team_id UUID,
    ADD COLUMN team_share_revision BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT "SharePermission_team_share_access_level_check"
        CHECK (team_share_access_level IN ('view', 'comment', 'edit')),
    ADD CONSTRAINT "SharePermission_team_share_pair_check"
        CHECK ((team_share_access_level IS NULL) = (team_share_team_id IS NULL)),
    ADD CONSTRAINT "SharePermission_team_share_revision_check"
        CHECK (team_share_revision >= 0);
