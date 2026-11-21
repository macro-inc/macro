-- Chats for the source-list equality test, after viewer_matrix.sql: one
-- per grant source, one holding every grant, and link shares.
INSERT INTO "Chat" (id, name, "userId")
SELECT matrix_item('chat', source_id)::text, 'Direct', 'macro|matrix-owner@example.com'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('chat', 'all')::text, 'All grants', 'macro|matrix-owner@example.com';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('chat', source_id), 'chat', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('chat', 'all'), 'chat', source_id, source_type, level
FROM matrix_grant_source;

-- TEAM links by owners in team A, in team B and in no team, a PUBLIC link,
-- and a TEAM link without a level.
INSERT INTO "Chat" (id, name, "userId") VALUES
(matrix_item('chat-link', 'team-a')::text, 'Team A link', 'macro|matrix-owner@example.com'),
(matrix_item('chat-link', 'team-b')::text, 'Team B link', 'macro|matrix-other@example.com'),
(matrix_item('chat-link', 'teamless')::text, 'Teamless link', 'macro|matrix-loner@example.com'),
(matrix_item('chat-link', 'public')::text, 'Public link', 'macro|matrix-loner@example.com'),
(matrix_item('chat-link', 'levelless')::text, 'Levelless link', 'macro|matrix-owner@example.com');
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
(matrix_item('chat-link', 'team-a')::text, 'TEAM', 'comment'),
(matrix_item('chat-link', 'team-b')::text, 'TEAM', 'edit'),
(matrix_item('chat-link', 'teamless')::text, 'TEAM', 'edit'),
(matrix_item('chat-link', 'public')::text, 'PUBLIC', 'view'),
(matrix_item('chat-link', 'levelless')::text, 'TEAM', NULL);
INSERT INTO "ChatPermission" ("chatId", "sharePermissionId")
SELECT id, id FROM "Chat" WHERE name LIKE '%link';
