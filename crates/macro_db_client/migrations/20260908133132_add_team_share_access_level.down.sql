-- Only roll back before canonical writers are enabled: this removes grant attribution.
-- Neither direction of this migration modifies entity_access grants.
ALTER TABLE "SharePermission"
    DROP CONSTRAINT "SharePermission_team_share_access_level_check",
    DROP CONSTRAINT "SharePermission_team_share_pair_check",
    DROP CONSTRAINT "SharePermission_team_share_revision_check",
    DROP COLUMN team_share_access_level,
    DROP COLUMN team_share_team_id,
    DROP COLUMN team_share_revision;
