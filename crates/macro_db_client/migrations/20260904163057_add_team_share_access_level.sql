-- Explicit share with the item owner's team. NULL = not shared with the team;
-- otherwise the access level every member of the owner's team receives.
-- Mirrored as an `entity_access` row with source_type = 'team' so that
-- access checks, soup feeds, and notification fan-out pick it up.
--
-- This is distinct from "linkShare" = 'TEAM', which only grants access to
-- team members who have the link and writes no `entity_access` row.
ALTER TABLE "SharePermission"
    ADD COLUMN "teamShareAccessLevel" "AccessLevel";

-- Backfill from the existing document team-share toggle, whose truth lived only
-- in `entity_access` (source_type = 'team', owner's team, not project-granted),
-- so the toggle and the share dialog agree from day one.
UPDATE "SharePermission" sp
SET "teamShareAccessLevel" = ea.access_level
FROM "DocumentPermission" dp
JOIN "Document" d ON d.id = dp."documentId"
JOIN team_user tu ON tu.user_id = d.owner
JOIN entity_access ea
    ON ea.entity_id::text = dp."documentId"
   AND ea.entity_type = 'document'
   AND ea.source_type = 'team'
   AND ea.source_id = tu.team_id::text
   AND ea.granted_from_project_id IS NULL
WHERE sp.id = dp."sharePermissionId";
