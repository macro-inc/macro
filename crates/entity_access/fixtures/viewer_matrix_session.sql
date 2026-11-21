-- Agent sessions for the source-list equality test, after viewer_matrix.sql:
-- one per grant source (half of them hidden from search), one holding every
-- grant, and link shares by owners in team A, team B and no team.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
(matrix_item('session-link', 'team-a')::text, 'TEAM', 'comment'),
(matrix_item('session-link', 'team-b')::text, 'TEAM', 'edit'),
(matrix_item('session-link', 'teamless')::text, 'TEAM', 'edit'),
(matrix_item('session-link', 'public')::text, 'PUBLIC', 'view'),
(matrix_item('session-link', 'levelless')::text, 'TEAM', NULL);
INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, share_permission_id, visibility)
SELECT matrix_item('session', source_id), 'macro|matrix-owner@example.com', '7a000000-0000-0000-0000-0000000000d1'::uuid,
       'model', 'harness', '/workspace', NULL,
       CASE WHEN level IN ('comment', 'owner') THEN 'hidden' ELSE 'listed' END
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('session', 'all'), 'macro|matrix-owner@example.com', '7a000000-0000-0000-0000-0000000000d1'::uuid,
       'model', 'harness', '/workspace', NULL, 'listed'
UNION ALL
SELECT matrix_item('session-link', link), owner, '7a000000-0000-0000-0000-0000000000d1'::uuid,
       'model', 'harness', '/workspace', matrix_item('session-link', link)::text, 'listed'
FROM (VALUES ('team-a', 'macro|matrix-owner@example.com'), ('team-b', 'macro|matrix-other@example.com'),
             ('teamless', 'macro|matrix-loner@example.com'), ('public', 'macro|matrix-loner@example.com'),
             ('levelless', 'macro|matrix-owner@example.com')) AS links(link, owner);
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('session', source_id), 'agent_session', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('session', 'all'), 'agent_session', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
-- A grant whose session row is gone still lists, as it did before.
SELECT matrix_item('session-gone', source_id), 'agent_session', source_id, source_type, level
FROM matrix_grant_source;
