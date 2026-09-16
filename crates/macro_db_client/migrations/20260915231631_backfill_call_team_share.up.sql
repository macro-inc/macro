-- Backfill canonical team sharing for calls from the legacy
-- `calls.share_with_team` / `call_records.share_with_team` flags.
--
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

-- 2. Active calls: the legacy flag promised View to the creator's team once
--    the call was archived; the canonical model grants it immediately at
--    creation, so create the grant now. The team is resolved like the
--    canonical loader (highest team_role first). The legacy flag is set FALSE
--    so an older archive_call cannot re-insert the same row.
WITH active AS (
    SELECT
        c.id AS call_id,
        c.share_permission_id,
        (
            SELECT tu.team_id
            FROM team_user tu
            WHERE tu.user_id = c.created_by
            ORDER BY tu.team_role DESC
            LIMIT 1
        ) AS team_id
    FROM calls c
    WHERE c.share_with_team
),
shared AS (
    UPDATE "SharePermission" sp
    SET team_share_access_level = 'view',
        team_share_team_id = a.team_id,
        team_share_revision = 1,
        "updatedAt" = NOW()
    FROM active a
    WHERE sp.id = a.share_permission_id
      AND a.team_id IS NOT NULL
      AND sp.team_share_access_level IS NULL
      AND sp.team_share_revision = 0
    RETURNING a.call_id, a.team_id
),
granted AS (
    INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    SELECT s.call_id, 'call', s.team_id::text, 'team', 'view'
    FROM shared s
    ON CONFLICT DO NOTHING
    RETURNING entity_id
)
UPDATE calls c
SET share_with_team = FALSE
FROM shared s
WHERE c.id = s.call_id;

-- 3. Flag FALSE but a legacy team View row still exists for the creator's
--    team (only set_share_with_team, archive_call and the seed tool ever wrote
--    call team rows). The canonical writer would treat that row as an
--    untracked grant and refuse every later change, so remove it. Only
--    permissions the canonical writers have never touched are affected.
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
