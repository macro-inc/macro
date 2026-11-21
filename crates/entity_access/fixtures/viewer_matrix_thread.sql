-- Email threads for the source-list equality test, after viewer_matrix.sql.
-- matrix-other's inbox (delegated to matrix-loner) holds one thread per grant
-- source granted to it, one holding every grant, and one per source in a
-- project granted to it. Inboxes of owners in team A, team B and no team hold
-- link-shared threads.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
(matrix_item('inbox', 'other'), 'macro|matrix-other@example.com', 'macro|matrix-other@example.com', 'matrix-other@mail.test', 'GMAIL'),
(matrix_item('inbox', 'owner'), 'macro|matrix-owner@example.com', 'macro|matrix-owner@example.com', 'matrix-owner@mail.test', 'GMAIL'),
(matrix_item('inbox', 'loner'), 'macro|matrix-loner@example.com', 'macro|matrix-loner@example.com', 'matrix-loner@mail.test', 'GMAIL');
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES
('macro|matrix-loner@example.com', 'macro|matrix-other@example.com', matrix_item('inbox', 'other'));

INSERT INTO email_threads (id, link_id)
SELECT matrix_item('thread', source_id), matrix_item('inbox', 'other') FROM matrix_grant_source
UNION ALL
SELECT matrix_item('thread', 'all'), matrix_item('inbox', 'other');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('thread', source_id), 'email_thread', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('thread', 'all'), 'email_thread', source_id, source_type, level
FROM matrix_grant_source;

INSERT INTO "Project" (id, name, "userId")
SELECT matrix_item('thread-project', source_id)::text, 'Thread project', 'macro|matrix-other@example.com'
FROM matrix_grant_source;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('thread-project', source_id), 'project', source_id, source_type, level
FROM matrix_grant_source;
INSERT INTO email_threads (id, link_id, project_id)
SELECT matrix_item('thread-in-project', source_id), matrix_item('inbox', 'other'),
       matrix_item('thread-project', source_id)::text
FROM matrix_grant_source;

-- TEAM links by inbox owners in team A, in team B and in no team, a PUBLIC
-- link, and a TEAM link without a level.
INSERT INTO email_threads (id, link_id) VALUES
(matrix_item('thread-link', 'team-a'), matrix_item('inbox', 'owner')),
(matrix_item('thread-link', 'team-b'), matrix_item('inbox', 'other')),
(matrix_item('thread-link', 'teamless'), matrix_item('inbox', 'loner')),
(matrix_item('thread-link', 'public'), matrix_item('inbox', 'loner')),
(matrix_item('thread-link', 'levelless'), matrix_item('inbox', 'owner'));
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel") VALUES
(matrix_item('thread-link', 'team-a')::text, 'TEAM', 'comment'),
(matrix_item('thread-link', 'team-b')::text, 'TEAM', 'edit'),
(matrix_item('thread-link', 'teamless')::text, 'TEAM', 'edit'),
(matrix_item('thread-link', 'public')::text, 'PUBLIC', 'view'),
(matrix_item('thread-link', 'levelless')::text, 'TEAM', NULL);
INSERT INTO "EmailThreadPermission" ("threadId", "sharePermissionId", "userId")
SELECT t.id::text, t.id::text, l.macro_id
FROM email_threads t JOIN email_links l ON l.id = t.link_id
WHERE t.id IN (
    matrix_item('thread-link', 'team-a'), matrix_item('thread-link', 'team-b'),
    matrix_item('thread-link', 'teamless'), matrix_item('thread-link', 'public'),
    matrix_item('thread-link', 'levelless')
);
