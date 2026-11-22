-- External chats for the source-list equality tests, after
-- viewer_matrix.sql: one per grant source, one holding every grant, and link
-- shares by owners in team A, team B and no team.
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT matrix_item('external-chat', source_id)::text, NULL::text, NULL::"AccessLevel" FROM matrix_grant_source
UNION ALL
SELECT matrix_item('external-chat', 'all')::text, NULL::text, NULL::"AccessLevel"
UNION ALL
SELECT matrix_item('external-chat-link', link)::text, share, level::"AccessLevel"
FROM (VALUES ('team-a', 'TEAM', 'comment'), ('team-b', 'TEAM', 'edit'), ('teamless', 'TEAM', 'edit'),
             ('public', 'PUBLIC', 'view'), ('levelless', 'TEAM', NULL)) AS links(link, share, level);
INSERT INTO external_chat (id, provider, remote_id, kind, name, share_permission_id, user_id, state)
SELECT id, 'whatsapp', row_number() OVER (ORDER BY id) || '@lid', 'direct', 'Matrix chat', id::text, owner, 'active'
FROM (
    SELECT matrix_item('external-chat', source_id) AS id, 'macro|matrix-owner@example.com' AS owner
    FROM matrix_grant_source
    UNION ALL
    SELECT matrix_item('external-chat', 'all'), 'macro|matrix-owner@example.com'
    UNION ALL
    SELECT matrix_item('external-chat-link', link), owner
    FROM (VALUES ('team-a', 'macro|matrix-owner@example.com'), ('team-b', 'macro|matrix-other@example.com'),
                 ('teamless', 'macro|matrix-loner@example.com'), ('public', 'macro|matrix-loner@example.com'),
                 ('levelless', 'macro|matrix-owner@example.com')) AS links(link, owner)
) AS chats;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('external-chat', source_id), 'external_chat', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('external-chat', 'all'), 'external_chat', source_id, source_type, level
FROM matrix_grant_source;
