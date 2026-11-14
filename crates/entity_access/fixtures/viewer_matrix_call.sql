-- Calls for the source-list equality test, after viewer_matrix.sql: one per
-- grant source, one holding every grant, and link shares.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT matrix_item('call', source_id)::text, NULL::text, NULL::"AccessLevel" FROM matrix_grant_source
UNION ALL
SELECT matrix_item('call', 'all')::text, NULL::text, NULL::"AccessLevel";
INSERT INTO call_entities (id, user_id, created_via, share_permission_id)
SELECT matrix_item('call', source_id), 'macro|matrix-owner@example.com', 'import', matrix_item('call', source_id)::text
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('call', 'all'), 'macro|matrix-owner@example.com', 'import', matrix_item('call', 'all')::text;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('call', source_id), 'call', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('call', 'all'), 'call', source_id, source_type, level
FROM matrix_grant_source;

-- TEAM links by creators in team A, in team B and in no team, a PUBLIC link,
-- and a TEAM link without a level.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
(matrix_item('call-link', 'team-a')::text, 'TEAM', 'comment'),
(matrix_item('call-link', 'team-b')::text, 'TEAM', 'edit'),
(matrix_item('call-link', 'teamless')::text, 'TEAM', 'edit'),
(matrix_item('call-link', 'public')::text, 'PUBLIC', 'view'),
(matrix_item('call-link', 'levelless')::text, 'TEAM', NULL);
INSERT INTO call_entities (id, user_id, created_via, share_permission_id) VALUES
(matrix_item('call-link', 'team-a'), 'macro|matrix-owner@example.com', 'import', matrix_item('call-link', 'team-a')::text),
(matrix_item('call-link', 'team-b'), 'macro|matrix-other@example.com', 'import', matrix_item('call-link', 'team-b')::text),
(matrix_item('call-link', 'teamless'), 'macro|matrix-loner@example.com', 'import', matrix_item('call-link', 'teamless')::text),
(matrix_item('call-link', 'public'), 'macro|matrix-loner@example.com', 'import', matrix_item('call-link', 'public')::text),
(matrix_item('call-link', 'levelless'), 'macro|matrix-owner@example.com', 'import', matrix_item('call-link', 'levelless')::text);
