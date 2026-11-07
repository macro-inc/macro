-- Applied after mixed_items_expanded: twelve accessible tasks, an hour apart,
-- more than one grouped page holds.
INSERT INTO public."Document" (id, name, owner, "createdAt", "updatedAt")
SELECT format('33333333-0000-0000-0000-%s', lpad(n::text, 12, '0')),
       format('Task %s', n),
       'macro|user-1@test.com',
       '2023-02-01 00:00:00+00'::timestamptz + n * interval '1 hour',
       '2023-02-01 00:00:00+00'::timestamptz + n * interval '1 hour'
FROM generate_series(1, 12) n;

INSERT INTO public."DocumentInstance" (id, "documentId", sha)
SELECT 1000 + n, format('33333333-0000-0000-0000-%s', lpad(n::text, 12, '0')), 'sha_task'
FROM generate_series(1, 12) n;

INSERT INTO public.document_sub_type (document_id, sub_type)
SELECT format('33333333-0000-0000-0000-%s', lpad(n::text, 12, '0')), 'task'
FROM generate_series(1, 12) n;

INSERT INTO public.entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT format('33333333-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid, 'document',
       'macro|user-1@test.com', 'user', 'view'
FROM generate_series(1, 12) n;
