-- The team-wide default link-share scope applied when items are shared via
-- link without an explicit choice. Mirrors "SharePermission"."linkShare":
-- NULL = link sharing off by default, TEAM = team members with the link,
-- PUBLIC = anyone with the link. Defaults to TEAM (backfills existing rows).
ALTER TABLE team
    ADD COLUMN default_link_share TEXT DEFAULT 'TEAM',
    ADD CONSTRAINT team_default_link_share_check
        CHECK (default_link_share IN ('PUBLIC', 'TEAM'));
