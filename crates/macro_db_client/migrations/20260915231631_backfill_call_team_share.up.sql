-- Backfill canonical team sharing for archived calls from the legacy
-- `call_records.share_with_team` flag and the direct team grants the old
-- archive code wrote.
--
-- Live calls are untouched: `calls.share_with_team` stays the pending toggle
-- and is translated into canonical state when the call is archived.
-- Canonical state lives on "SharePermission" (team_share_access_level,
-- team_share_team_id, team_share_revision) plus a managed entity_access team
-- row. Every step only touches SharePermission rows the canonical writers have
-- never seen (NULL level, revision 0), so the migration is idempotent and can
-- be re-run once older service pods have drained.

-- 1. Archived records: adopt exactly one existing team View grant.
--    Joining a team after a call was archived must not reshare the record, so
--    no grant is created here. Records with several team rows or a non-view
--    team row are left untouched for manual review.
WITH team_grants AS (
    SELECT
        ea.entity_id,
        ea.source_id,
        COUNT(*) OVER (PARTITION BY ea.entity_id) AS grant_count,
        bool_and(ea.access_level = 'view') OVER (PARTITION BY ea.entity_id) AS all_view
    FROM entity_access ea
    WHERE ea.entity_type = 'call'
      AND ea.source_type = 'team'
      AND ea.granted_from_project_id IS NULL
),
adoptable AS (
    SELECT cr.share_permission_id, tg.source_id::uuid AS team_id
    FROM call_records cr
    JOIN team_grants tg ON tg.entity_id = cr.id
    WHERE cr.share_with_team
      AND tg.grant_count = 1
      AND tg.all_view
      AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.id = cr.id)
)
UPDATE "SharePermission" sp
SET team_share_access_level = 'view',
    team_share_team_id = a.team_id,
    team_share_revision = 1,
    "updatedAt" = NOW()
FROM adoptable a
WHERE sp.id = a.share_permission_id
  AND sp.team_share_access_level IS NULL
  AND sp.team_share_revision = 0;

-- 2. Flag FALSE but a legacy team View row still exists for the creator's
--    team (only set_share_with_team, archive_call and the seed tool ever wrote
--    call team rows). The canonical writer would treat that row as an
--    untracked grant and refuse every later change, and the archive
--    translation would leave it granting access the toggle revoked, so remove
--    it. Only permissions the canonical writers have never touched are affected.
DELETE FROM entity_access ea
USING (
    SELECT c.id AS call_id, c.created_by, c.share_permission_id
    FROM calls c
    WHERE NOT c.share_with_team
    UNION ALL
    SELECT cr.id, cr.created_by, cr.share_permission_id
    FROM call_records cr
    WHERE NOT cr.share_with_team
      AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.id = cr.id)
) off_calls
JOIN team_user tu ON tu.user_id = off_calls.created_by
JOIN "SharePermission" sp ON sp.id = off_calls.share_permission_id
WHERE ea.entity_id = off_calls.call_id
  AND ea.entity_type = 'call'
  AND ea.source_type = 'team'
  AND ea.source_id = tu.team_id::text
  AND ea.access_level = 'view'
  AND ea.granted_from_project_id IS NULL
  AND sp.team_share_access_level IS NULL
  AND sp.team_share_revision = 0;
