-- Fixture for the soup feed that reads source_items. It loads with triggers on, so source_items
-- holds what its triggers derived.
--
-- user-1 is the subject and sees items through their own id, team T1 and channel C1. They left
-- channel C2 and are not in team T2, so items granted only to those, or only to user-2, stay
-- hidden, as do soft-deleted items. Documents, chats and projects share "updatedAt" values, so
-- pages split ties within and across entity types.
--
-- Items are numbered: document i is 11111111-0000-4000-8000-<i>, chat i is
-- 22222222-0000-4000-8000-<i> and project Pn is aaaaaaaa-0000-4000-8000-<n>, with the number
-- zero-padded to 12 digits.

INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT');

INSERT INTO public.macro_user ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@test.com', 'user@test.com', 'stripe_id_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_id_2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_id_3');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111'),
       ('macro|user-2@test.com', 'user2@test.com', 'stripe_id_2', 1, 'a2222222-2222-2222-2222-222222222222'),
       ('macro|user-3@test.com', 'user3@test.com', 'stripe_id_3', 1, 'a3333333-3333-3333-3333-333333333333');

INSERT INTO public.team ("id", "name", "owner_id")
VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Team T1', 'macro|user-2@test.com'),
       ('eeeeeeee-0000-4000-8000-000000000002', 'Team T2', 'macro|user-3@test.com');

INSERT INTO public.team_user ("user_id", "team_id", "team_role")
VALUES ('macro|user-1@test.com', 'eeeeeeee-0000-4000-8000-000000000001', 'member'),
       ('macro|user-2@test.com', 'eeeeeeee-0000-4000-8000-000000000001', 'owner'),
       ('macro|user-3@test.com', 'eeeeeeee-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id")
VALUES ('cccccccc-0000-4000-8000-000000000001', 'private', 'macro|user-2@test.com'),
       ('cccccccc-0000-4000-8000-000000000002', 'private', 'macro|user-2@test.com');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "left_at")
VALUES ('cccccccc-0000-4000-8000-000000000001', 'member', 'macro|user-1@test.com', NULL),
       ('cccccccc-0000-4000-8000-000000000002', 'member', 'macro|user-1@test.com', '2024-01-15 00:00:00+00');

---------------------------------------------------
--  ITEMS
---------------------------------------------------

-- P1 is user-1's and P7 sits in it. P6 is user-1's but soft-deleted.
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt", "deletedAt")
SELECT format('aaaaaaaa-0000-4000-8000-%s', lpad(n::text, 12, '0')),
       'Project ' || n,
       CASE WHEN n IN (1, 6, 7) THEN 'macro|user-1@test.com' ELSE 'macro|user-2@test.com' END,
       CASE WHEN n = 7 THEN 'aaaaaaaa-0000-4000-8000-000000000001' END,
       '2024-01-01'::timestamp + n * interval '1 day',
       '2024-02-01'::timestamp + (n * 5 / 2) * interval '1 hour',
       CASE WHEN n = 6 THEN '2024-03-01'::timestamp END
FROM generate_series(1, 7) n;

-- user-1 owns every third document. By i % 8 a document is in P1, P2, P3, P4 or P7, or in no
-- project. Every thirteenth document is soft-deleted.
INSERT INTO public."Document" ("id", "name", "owner", "fileType", "projectId", "createdAt", "updatedAt", "deletedAt")
SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')),
       'Document ' || i,
       CASE WHEN i % 3 = 0 THEN 'macro|user-1@test.com' ELSE 'macro|user-2@test.com' END,
       CASE WHEN i % 2 = 0 THEN 'md' ELSE 'pdf' END,
       CASE i % 8
           WHEN 0 THEN 'aaaaaaaa-0000-4000-8000-000000000001'
           WHEN 1 THEN 'aaaaaaaa-0000-4000-8000-000000000002'
           WHEN 2 THEN 'aaaaaaaa-0000-4000-8000-000000000003'
           WHEN 3 THEN 'aaaaaaaa-0000-4000-8000-000000000004'
           WHEN 4 THEN 'aaaaaaaa-0000-4000-8000-000000000007'
       END,
       '2024-01-01'::timestamp + i * interval '1 minute',
       '2024-02-01'::timestamp + (i / 2) * interval '1 hour',
       CASE WHEN i % 13 = 0 THEN '2024-03-01'::timestamp END
FROM generate_series(1, 72) i;

INSERT INTO public."DocumentInstance" ("documentId", "sha", "createdAt", "updatedAt")
SELECT id, 'sha-' || id, "createdAt", "updatedAt" FROM public."Document";

-- Every fourth document is a task and every ninth other one a snippet. Added after the documents,
-- so their kind changes after their source_items rows exist.
INSERT INTO public.document_sub_type ("document_id", "sub_type")
SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')),
       (CASE WHEN i % 4 = 0 THEN 'task' ELSE 'snippet' END)::document_sub_type_value
FROM generate_series(1, 72) i
WHERE i % 4 = 0 OR i % 9 = 0;

-- user-1 owns the even chats. By i % 6 a chat is in P1 or P3, or in no project. Every eleventh
-- chat is soft-deleted.
INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt", "deletedAt")
SELECT format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')),
       'Chat ' || i,
       CASE WHEN i % 2 = 0 THEN 'macro|user-1@test.com' ELSE 'macro|user-2@test.com' END,
       CASE i % 6
           WHEN 0 THEN 'aaaaaaaa-0000-4000-8000-000000000001'
           WHEN 1 THEN 'aaaaaaaa-0000-4000-8000-000000000003'
       END,
       '2024-01-01'::timestamp + i * interval '1 minute',
       '2024-02-01'::timestamp + (i / 2) * interval '1 hour',
       CASE WHEN i % 11 = 0 THEN '2024-03-01'::timestamp END
FROM generate_series(1, 24) i;

---------------------------------------------------
--  ACCESS
---------------------------------------------------

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'project', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000002', 'project', 'eeeeeeee-0000-4000-8000-000000000001', 'team', 'view', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000003', 'project', 'cccccccc-0000-4000-8000-000000000001', 'channel', 'view', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000004', 'project', 'cccccccc-0000-4000-8000-000000000002', 'channel', 'view', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000005', 'project', 'eeeeeeee-0000-4000-8000-000000000002', 'team', 'view', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000006', 'project', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('aaaaaaaa-0000-4000-8000-000000000007', 'project', 'macro|user-1@test.com', 'user', 'owner', 'aaaaaaaa-0000-4000-8000-000000000001');

-- By i % 6 a document or chat is granted to user-1, T1, C1, C2, T2 or user-2.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
SELECT item.id::uuid, item.entity_type, source.id, source.source_type::entity_access_source_type, 'view'
FROM (
    SELECT 'document' AS entity_type, format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')) AS id, i
    FROM generate_series(1, 72) i
    UNION ALL
    SELECT 'chat', format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')), i
    FROM generate_series(1, 24) i
) item
JOIN (
    VALUES (0, 'macro|user-1@test.com', 'user'),
           (1, 'eeeeeeee-0000-4000-8000-000000000001', 'team'),
           (2, 'cccccccc-0000-4000-8000-000000000001', 'channel'),
           (3, 'cccccccc-0000-4000-8000-000000000002', 'channel'),
           (4, 'eeeeeeee-0000-4000-8000-000000000002', 'team'),
           (5, 'macro|user-2@test.com', 'user')
) source (n, id, source_type) ON source.n = item.i % 6;

-- Documents with i % 10 = 7 are also in C1, so user-1 reaches them through two sources.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid, 'document',
       'cccccccc-0000-4000-8000-000000000001', 'channel', 'view'
FROM generate_series(1, 72) i
WHERE i % 10 = 7;

-- Items in P1 or P7 inherit user-1's grant on P1, and documents in P2 inherit T1's grant on P2, so
-- some items have two grants from one source.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
SELECT d.id::uuid, 'document', 'macro|user-1@test.com', 'user'::entity_access_source_type,
       'view'::"AccessLevel", 'aaaaaaaa-0000-4000-8000-000000000001'
FROM public."Document" d
WHERE d."projectId" IN ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000007')
UNION ALL
SELECT c.id::uuid, 'chat', 'macro|user-1@test.com', 'user'::entity_access_source_type,
       'view'::"AccessLevel", 'aaaaaaaa-0000-4000-8000-000000000001'
FROM public."Chat" c
WHERE c."projectId" = 'aaaaaaaa-0000-4000-8000-000000000001'
UNION ALL
SELECT d.id::uuid, 'document', 'eeeeeeee-0000-4000-8000-000000000001', 'team'::entity_access_source_type,
       'view'::"AccessLevel", 'aaaaaaaa-0000-4000-8000-000000000002'
FROM public."Document" d
WHERE d."projectId" = 'aaaaaaaa-0000-4000-8000-000000000002';

---------------------------------------------------
--  PROPERTIES
---------------------------------------------------

-- Tasks before document 60 have a status, in progress when i % 8 = 0 and completed otherwise, and
-- assignees: user-1 when i % 12 = 0, user-2 when i % 12 = 4 and both when i % 12 = 8. Priority is
-- low on documents with i % 3 = 1, on tasks before document 60 with i % 16 = 0, on chats with
-- i % 4 = 1, and on P1 and P3.
INSERT INTO public.entity_properties ("id", "entity_id", "entity_type", "property_definition_id", "values")
SELECT md5(p.entity_type || p.entity_id || p.property_definition_id)::uuid, p.entity_id,
       p.entity_type::property_entity_type, p.property_definition_id::uuid, p.values::jsonb
FROM (
    SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')) AS entity_id, 'TASK' AS entity_type,
           '00000001-0000-0000-0000-000000000002' AS property_definition_id,
           format('{"type": "SelectOption", "value": ["%s"]}',
                  CASE WHEN i % 8 = 0 THEN '00000001-0000-0000-0002-000000000002'
                       ELSE '00000001-0000-0000-0002-000000000004' END) AS values
    FROM generate_series(1, 59) i
    WHERE i % 4 = 0
    UNION ALL
    SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'TASK',
           '00000001-0000-0000-0000-000000000001',
           format('{"type": "EntityReference", "value": %s}',
                  CASE i % 12
                      WHEN 0 THEN '[{"entity_type": "USER", "entity_id": "macro|user-1@test.com"}]'
                      WHEN 4 THEN '[{"entity_type": "USER", "entity_id": "macro|user-2@test.com"}]'
                      ELSE '[{"entity_type": "USER", "entity_id": "macro|user-2@test.com"}, {"entity_type": "USER", "entity_id": "macro|user-1@test.com"}]'
                  END)
    FROM generate_series(1, 59) i
    WHERE i % 4 = 0
    UNION ALL
    SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'DOCUMENT',
           '00000001-0000-0000-0000-000000000003',
           '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}'
    FROM generate_series(1, 72) i
    WHERE i % 3 = 1 AND i % 4 <> 0
    UNION ALL
    SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'TASK',
           '00000001-0000-0000-0000-000000000003',
           '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}'
    FROM generate_series(1, 59) i
    WHERE i % 16 = 0
    UNION ALL
    SELECT format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'CHAT',
           '00000001-0000-0000-0000-000000000003',
           '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}'
    FROM generate_series(1, 24) i
    WHERE i % 4 = 1
    UNION ALL
    SELECT format('aaaaaaaa-0000-4000-8000-%s', lpad(n::text, 12, '0')), 'PROJECT',
           '00000001-0000-0000-0000-000000000003',
           '{"type": "SelectOption", "value": ["00000001-0000-0000-0003-000000000001"]}'
    FROM unnest(ARRAY[1, 3]) n
) p;

---------------------------------------------------
--  HISTORY, FRECENCY AND NOTIFICATIONS
---------------------------------------------------

-- user-1 viewed documents with i % 3 = 1 four at a time, documents with i % 5 = 2 before their
-- last update, chats with i % 3 = 0 two at a time, and P1, P3, P4 and P6. Some of those are
-- hidden from user-1. user-2's view of document 2 must not count.
INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
SELECT 'macro|user-1@test.com', v.id, v.item_type, v.ts, v.ts
FROM (
    SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')) AS id, 'document' AS item_type,
           CASE WHEN i % 3 = 1 THEN '2024-03-01'::timestamp + (i / 12) * interval '1 hour'
                ELSE '2024-01-20'::timestamp + i * interval '1 minute' END AS ts
    FROM generate_series(1, 72) i
    WHERE i % 3 = 1 OR i % 5 = 2
    UNION ALL
    SELECT format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'chat',
           '2024-03-01'::timestamp + (i / 6) * interval '1 hour'
    FROM generate_series(1, 24) i
    WHERE i % 3 = 0
    UNION ALL
    SELECT format('aaaaaaaa-0000-4000-8000-%s', lpad(n::text, 12, '0')), 'project',
           '2024-03-01'::timestamp + n * interval '1 hour'
    FROM unnest(ARRAY[1, 3, 4, 6]) n
) v
UNION ALL
VALUES ('macro|user-2@test.com', '11111111-0000-4000-8000-000000000002', 'document',
        '2024-03-09'::timestamp, '2024-03-09'::timestamp);

-- user-1 has frecency on documents with i % 7 = 0, chats with i % 5 = 0 and P2. user-2's frecency
-- on document 1 must not count.
INSERT INTO public.frecency_aggregates ("entity_id", "entity_type", "user_id", "event_count", "frecency_score", "first_event")
SELECT format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'document', 'macro|user-1@test.com', 1, 1.0,
       '2024-01-01'::timestamptz
FROM generate_series(1, 72) i
WHERE i % 7 = 0
UNION ALL
SELECT format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'chat', 'macro|user-1@test.com', 1, 1.0,
       '2024-01-01'::timestamptz
FROM generate_series(1, 24) i
WHERE i % 5 = 0
UNION ALL
VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'project', 'macro|user-1@test.com', 1, 1.0, '2024-01-01'::timestamptz),
       ('11111111-0000-4000-8000-000000000001', 'document', 'macro|user-2@test.com', 1, 1.0, '2024-01-01'::timestamptz);

-- user-1's notifications are unseen for documents with i % 5 = 0, chats with i % 4 = 0, P1 and the
-- hidden P4, and seen for documents with i % 5 = 1. A deleted unseen row on document 2 and user-2's
-- unseen row on document 3 must not count.
WITH wanted (item_type, item_id, user_id, state, deleted_at) AS (
    SELECT 'document', format('11111111-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'macro|user-1@test.com',
           CASE WHEN i % 5 = 0 THEN 'unseen' ELSE 'seen' END, NULL::timestamp
    FROM generate_series(1, 72) i
    WHERE i % 5 IN (0, 1)
    UNION ALL
    SELECT 'chat', format('22222222-0000-4000-8000-%s', lpad(i::text, 12, '0')), 'macro|user-1@test.com',
           'unseen', NULL::timestamp
    FROM generate_series(1, 24) i
    WHERE i % 4 = 0
    UNION ALL
    VALUES ('project', 'aaaaaaaa-0000-4000-8000-000000000001', 'macro|user-1@test.com', 'unseen', NULL::timestamp),
           ('project', 'aaaaaaaa-0000-4000-8000-000000000004', 'macro|user-1@test.com', 'unseen', NULL::timestamp),
           ('document', '11111111-0000-4000-8000-000000000002', 'macro|user-1@test.com', 'unseen', '2024-03-03'::timestamp),
           ('document', '11111111-0000-4000-8000-000000000003', 'macro|user-2@test.com', 'unseen', NULL::timestamp)
), notified AS (
    INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at")
    SELECT md5(item_type || item_id || user_id)::uuid, item_type || '_mention', item_id, item_type, 'test', '2024-03-02'
    FROM wanted
)
INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "state", "deleted_at")
SELECT user_id, md5(item_type || item_id || user_id)::uuid, '2024-03-02', state::notification_state, deleted_at
FROM wanted;
