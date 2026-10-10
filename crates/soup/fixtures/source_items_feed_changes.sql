-- Writes on top of source_items_feed.sql that reach source_items through each of its triggers,
-- plus history, frecency, notification and channel changes that only the read path sees. Items
-- are numbered as in source_items_feed.sql.

---------------------------------------------------
--  GRANTS
---------------------------------------------------

-- Document 5 was user-2's alone and is now shared with T1.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('11111111-0000-4000-8000-000000000005', 'document', 'eeeeeeee-0000-4000-8000-000000000001', 'team', 'view');

-- One statement grants user-1 every document in P3, so some documents gain a second grant from
-- user-1.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
SELECT d.id::uuid, 'document', 'macro|user-1@test.com', 'user', 'view', d."projectId"
FROM public."Document" d
WHERE d."projectId" = 'aaaaaaaa-0000-4000-8000-000000000003';

-- T1's direct grants go from documents 1, 7 and 19. Document 1 keeps T1's grant inherited from
-- P2, document 7 keeps C1's, and document 19 has nothing user-1 can use.
DELETE FROM public.entity_access
WHERE "entity_type" = 'document'
  AND "source_id" = 'eeeeeeee-0000-4000-8000-000000000001'
  AND "granted_from_project_id" IS NULL
  AND "entity_id" IN ('11111111-0000-4000-8000-000000000001',
                      '11111111-0000-4000-8000-000000000007',
                      '11111111-0000-4000-8000-000000000019');

-- Document 22's grant moves from T2 to user-1. Document 2's grants change access level only.
UPDATE public.entity_access SET "source_id" = 'macro|user-1@test.com', "source_type" = 'user'
WHERE "entity_id" = '11111111-0000-4000-8000-000000000022'
  AND "source_id" = 'eeeeeeee-0000-4000-8000-000000000002';

UPDATE public.entity_access SET "access_level" = 'edit'
WHERE "entity_id" = '11111111-0000-4000-8000-000000000002';

-- In one statement T1's direct grant on document 31 moves to C1, and T1's grant on document 41
-- inherited from P2 moves onto document 31, so a grant moves onto the (item, source) another
-- grant leaves.
UPDATE public.entity_access
SET "entity_id" = CASE WHEN "granted_from_project_id" IS NULL THEN "entity_id"
                       ELSE '11111111-0000-4000-8000-000000000031'::uuid END,
    "source_id" = CASE WHEN "granted_from_project_id" IS NULL THEN 'cccccccc-0000-4000-8000-000000000001'
                       ELSE "source_id" END,
    "source_type" = CASE WHEN "granted_from_project_id" IS NULL THEN 'channel'::entity_access_source_type
                         ELSE "source_type" END
WHERE "source_id" = 'eeeeeeee-0000-4000-8000-000000000001'
  AND (("entity_id" = '11111111-0000-4000-8000-000000000031' AND "granted_from_project_id" IS NULL)
       OR ("entity_id" = '11111111-0000-4000-8000-000000000041'
           AND "granted_from_project_id" = 'aaaaaaaa-0000-4000-8000-000000000002'));

---------------------------------------------------
--  ITEMS
---------------------------------------------------

-- Document 8 and chat 6 become the newest items, tied, and P2 moves up. Renaming document 10
-- leaves its sort key alone.
UPDATE public."Document" SET "updatedAt" = '2024-02-03 00:00:00'
WHERE "id" = '11111111-0000-4000-8000-000000000008';

UPDATE public."Chat" SET "updatedAt" = '2024-02-03 00:00:00'
WHERE "id" = '22222222-0000-4000-8000-000000000006';

UPDATE public."Project" SET "updatedAt" = '2024-02-02 12:00:00'
WHERE "id" = 'aaaaaaaa-0000-4000-8000-000000000002';

UPDATE public."Document" SET "name" = 'Renamed'
WHERE "id" = '11111111-0000-4000-8000-000000000010';

-- Document 12 is soft-deleted. Document 26 and P6 are restored.
UPDATE public."Document" SET "deletedAt" = '2024-03-05 00:00:00'
WHERE "id" = '11111111-0000-4000-8000-000000000012';

UPDATE public."Document" SET "deletedAt" = NULL
WHERE "id" = '11111111-0000-4000-8000-000000000026';

UPDATE public."Project" SET "deletedAt" = NULL
WHERE "id" = 'aaaaaaaa-0000-4000-8000-000000000006';

DELETE FROM public."Chat" WHERE "id" = '22222222-0000-4000-8000-000000000002';

-- Sub type changes, on documents without properties so their property rows keep their entity type.
-- Documents 2 and 9 become tasks, document 60 stops being one, and document 18 stays a document.
INSERT INTO public.document_sub_type ("document_id", "sub_type")
VALUES ('11111111-0000-4000-8000-000000000002', 'task');

UPDATE public.document_sub_type SET "sub_type" = 'task'
WHERE "document_id" = '11111111-0000-4000-8000-000000000009';

DELETE FROM public.document_sub_type
WHERE "document_id" = '11111111-0000-4000-8000-000000000060';

UPDATE public.document_sub_type SET "sub_type" = 'skill'
WHERE "document_id" = '11111111-0000-4000-8000-000000000018';

-- New items, tied on "updatedAt". Document 73's grant follows it. Document 74's grant comes first,
-- so inserting the document has to pick it up. P8 is shared with C1 and document 75 inherits that.
INSERT INTO public."Document" ("id", "name", "owner", "fileType", "projectId", "createdAt", "updatedAt")
VALUES ('11111111-0000-4000-8000-000000000073', 'Document 73', 'macro|user-1@test.com', 'md', NULL,
        '2024-01-02 00:00:00', '2024-02-02 06:00:00');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('11111111-0000-4000-8000-000000000073', 'document', 'macro|user-1@test.com', 'user', 'owner'),
       ('11111111-0000-4000-8000-000000000074', 'document', 'eeeeeeee-0000-4000-8000-000000000001', 'team', 'view');

INSERT INTO public."Document" ("id", "name", "owner", "fileType", "projectId", "createdAt", "updatedAt")
VALUES ('11111111-0000-4000-8000-000000000074', 'Document 74', 'macro|user-2@test.com', 'pdf', NULL,
        '2024-01-02 00:00:00', '2024-02-02 06:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-0000-4000-8000-000000000008', 'Project 8', 'macro|user-2@test.com',
        '2024-01-09 00:00:00', '2024-02-02 06:00:00');

INSERT INTO public."Document" ("id", "name", "owner", "fileType", "projectId", "createdAt", "updatedAt")
VALUES ('11111111-0000-4000-8000-000000000075', 'Document 75', 'macro|user-2@test.com', 'md',
        'aaaaaaaa-0000-4000-8000-000000000008', '2024-01-02 00:00:00', '2024-02-02 06:00:00');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('aaaaaaaa-0000-4000-8000-000000000008', 'project', 'cccccccc-0000-4000-8000-000000000001', 'channel', 'view', NULL),
       ('11111111-0000-4000-8000-000000000075', 'document', 'cccccccc-0000-4000-8000-000000000001', 'channel', 'view',
        'aaaaaaaa-0000-4000-8000-000000000008');

INSERT INTO public."DocumentInstance" ("documentId", "sha", "createdAt", "updatedAt")
SELECT "id", 'sha-' || "id", "createdAt", "updatedAt"
FROM public."Document"
WHERE "id" IN ('11111111-0000-4000-8000-000000000073',
               '11111111-0000-4000-8000-000000000074',
               '11111111-0000-4000-8000-000000000075');

---------------------------------------------------
--  READ PATH ONLY
---------------------------------------------------

-- user-1 rejoins C2.
UPDATE public.comms_channel_participants SET "left_at" = NULL
WHERE "channel_id" = 'cccccccc-0000-4000-8000-000000000002' AND "user_id" = 'macro|user-1@test.com';

-- user-1 views document 5 and chat 3 last, tied, and forgets having viewed document 4.
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES ('macro|user-1@test.com', '11111111-0000-4000-8000-000000000005', 'document',
        '2024-03-10 00:00:00', '2024-03-10 00:00:00');

UPDATE public."UserHistory" SET "updatedAt" = '2024-03-10 00:00:00'
WHERE "userId" = 'macro|user-1@test.com' AND "itemId" = '22222222-0000-4000-8000-000000000003';

DELETE FROM public."UserHistory"
WHERE "userId" = 'macro|user-1@test.com' AND "itemId" = '11111111-0000-4000-8000-000000000004';

-- user-1 gains frecency on document 2 and loses it on document 7.
INSERT INTO public.frecency_aggregates ("entity_id", "entity_type", "user_id", "event_count", "frecency_score", "first_event")
VALUES ('11111111-0000-4000-8000-000000000002', 'document', 'macro|user-1@test.com', 1, 1.0, '2024-01-01');

DELETE FROM public.frecency_aggregates
WHERE "user_id" = 'macro|user-1@test.com' AND "entity_id" = '11111111-0000-4000-8000-000000000007';

-- user-1 is notified about document 4 and has seen the notification about document 10.
INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at")
VALUES (md5('document11111111-0000-4000-8000-000000000004macro|user-1@test.com')::uuid, 'document_mention',
        '11111111-0000-4000-8000-000000000004', 'document', 'test', '2024-03-02');

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "state")
VALUES ('macro|user-1@test.com', md5('document11111111-0000-4000-8000-000000000004macro|user-1@test.com')::uuid,
        '2024-03-02', 'unseen');

UPDATE public.user_notification SET "state" = 'seen'
WHERE "user_id" = 'macro|user-1@test.com'
  AND "notification_id" = md5('document11111111-0000-4000-8000-000000000010macro|user-1@test.com')::uuid;
