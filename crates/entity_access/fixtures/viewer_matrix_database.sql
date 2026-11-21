-- Databases, their rows and forms for the source-list equality tests, after
-- viewer_matrix.sql. Per grant source: a database granted to it; a database
-- reached only through a form granted to it, once with responses visible and
-- once without; and a trashed form granted to it. One database holds every
-- grant, one holding every grant is core storage with no app entity, and two
-- forms are public.
INSERT INTO databases (id)
SELECT matrix_item(kind, source_id)
FROM matrix_grant_source
CROSS JOIN (VALUES ('database'), ('form-database'), ('hidden-form-database'), ('trashed-form-database')) AS kinds(kind)
UNION ALL
SELECT matrix_item('database', 'all')
UNION ALL
SELECT matrix_item('public-form-database', 'all');
INSERT INTO database_entities (database_id, name, user_id)
SELECT id, 'Matrix database', 'macro|matrix-owner@example.com' FROM databases;
INSERT INTO databases (id) VALUES (matrix_item('core-database', 'all'));
INSERT INTO database_tables (id, database_id, name, position)
SELECT id, id, 'Matrix table', 'a0' FROM databases;
INSERT INTO database_rows (id, table_id, position)
SELECT md5('row:' || id::text)::uuid, id, 'a0' FROM databases;
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item('database', source_id), 'database', source_id, source_type, level
FROM matrix_grant_source
UNION ALL
SELECT matrix_item(kind, 'all'), 'database', source_id, source_type, level
FROM matrix_grant_source
CROSS JOIN (VALUES ('database'), ('core-database')) AS kinds(kind);

INSERT INTO forms (id, name, owner_id, database_id, table_id, responses_visible, trashed_at, audience)
SELECT matrix_item('form', source_id), 'Visible responses', 'macro|matrix-owner@example.com',
       matrix_item('form-database', source_id), matrix_item('form-database', source_id), true, NULL::timestamptz, 'members'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('hidden-form', source_id), 'Hidden responses', 'macro|matrix-owner@example.com',
       matrix_item('hidden-form-database', source_id), matrix_item('hidden-form-database', source_id), false, NULL, 'members'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('trashed-form', source_id), 'Trashed', 'macro|matrix-owner@example.com',
       matrix_item('trashed-form-database', source_id), matrix_item('trashed-form-database', source_id), true, now(), 'public'
FROM matrix_grant_source
UNION ALL
SELECT matrix_item('public-form', 'all'), 'Public', 'macro|matrix-owner@example.com',
       matrix_item('public-form-database', 'all'), matrix_item('public-form-database', 'all'), false, NULL, 'public';
-- Form grants at each level a form grant gives a database: view, edit, owner.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT matrix_item(form, source_id), 'form', source_id, source_type,
       CASE level WHEN 'comment' THEN 'view' ELSE level END
FROM matrix_grant_source
CROSS JOIN (VALUES ('form'), ('hidden-form'), ('trashed-form')) AS forms(form);
