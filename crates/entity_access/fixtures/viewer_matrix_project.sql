-- Projects for the source-list equality test, after viewer_matrix.sql: one
-- per grant source, one holding every grant, and link shares.
INSERT INTO "Project" (id, name, "userId")
SELECT matrix_item('project', source_id)::text, 'Direct', 'macro|matrix-owner@example.com'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('project', 'all')::text, 'All grants', 'macro|matrix-owner@example.com';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('project', source_id), 'project', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('project', 'all'), 'project', source_id, source_type, level
FROM matrix_grant_source;

-- TEAM links by owners in team A, in team B and in no team, a PUBLIC link,
-- and a TEAM link without a level.
INSERT INTO "Project" (id, name, "userId") VALUES
(matrix_item('project-link', 'team-a')::text, 'Team A link', 'macro|matrix-owner@example.com'),
(matrix_item('project-link', 'team-b')::text, 'Team B link', 'macro|matrix-other@example.com'),
(matrix_item('project-link', 'teamless')::text, 'Teamless link', 'macro|matrix-loner@example.com'),
(matrix_item('project-link', 'public')::text, 'Public link', 'macro|matrix-loner@example.com'),
(matrix_item('project-link', 'levelless')::text, 'Levelless link', 'macro|matrix-owner@example.com');
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
(matrix_item('project-link', 'team-a')::text, 'TEAM', 'comment'),
(matrix_item('project-link', 'team-b')::text, 'TEAM', 'edit'),
(matrix_item('project-link', 'teamless')::text, 'TEAM', 'edit'),
(matrix_item('project-link', 'public')::text, 'PUBLIC', 'view'),
(matrix_item('project-link', 'levelless')::text, 'TEAM', NULL);
INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId")
SELECT id, id FROM "Project" WHERE name LIKE '%link';
