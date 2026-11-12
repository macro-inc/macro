-- Initiatives for the source-list equality test, after viewer_matrix.sql: one
-- per grant source, one holding every grant, and link shares by owners in
-- team A, team B and no team.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT matrix_item('initiative', source_id)::text, NULL::text, NULL::"AccessLevel" FROM matrix_grant_source
UNION ALL
SELECT matrix_item('initiative', 'all')::text, NULL::text, NULL::"AccessLevel"
UNION ALL
SELECT matrix_item('initiative-link', link)::text, share, level::"AccessLevel"
FROM (VALUES ('team-a', 'TEAM', 'comment'), ('team-b', 'TEAM', 'edit'), ('teamless', 'TEAM', 'edit'),
             ('public', 'PUBLIC', 'view'), ('levelless', 'TEAM', NULL)) AS links(link, share, level);
INSERT INTO initiative (id, name, owner_user_id, share_permission_id)
SELECT matrix_item('initiative', source_id), 'Direct', 'macro|matrix-owner@example.com',
       matrix_item('initiative', source_id)::text
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('initiative', 'all'), 'All grants', 'macro|matrix-owner@example.com',
       matrix_item('initiative', 'all')::text
UNION ALL
SELECT matrix_item('initiative-link', link), 'Link', owner, matrix_item('initiative-link', link)::text
FROM (VALUES ('team-a', 'macro|matrix-owner@example.com'), ('team-b', 'macro|matrix-other@example.com'),
             ('teamless', 'macro|matrix-loner@example.com'), ('public', 'macro|matrix-loner@example.com'),
             ('levelless', 'macro|matrix-owner@example.com')) AS links(link, owner);
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('initiative', source_id), 'initiative', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('initiative', 'all'), 'initiative', source_id, source_type, level
FROM matrix_grant_source;
