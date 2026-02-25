-- Exhaustive fixture for expanded_dynamic_cursor_soup tests.
--
-- Covers:
--   - 3-level deep project hierarchy (root -> mid -> deep)
--   - Deleted items (doc + chat) that must be excluded
--   - Task documents with completed/incomplete/no-status states
--   - Isolated project with no access for user-1
--   - Second user for access isolation testing
--   - Multi-owner items (user-2 owns doc/chat in user-1's project)
--   - Standalone items (no project) with direct access
--   - Frecency records on some items
--   - Multiple file types (pdf, docx, txt, md)
--   - Distinct timestamps for createdAt, updatedAt, and UserHistory.updatedAt
--     so all four sort methods (viewed_at, updated_at, created_at, viewed_updated)
--     produce different orderings.
--
-- User-1 accessible items (14 total):
--   Projects: project-root, project-mid, project-deep  (3)
--   Documents: doc-root-pdf, doc-mid-docx, doc-deep-pdf, doc-standalone-txt,
--              doc-task-completed, doc-task-incomplete, doc-task-no-status,
--              doc-shared-md  (8)
--   Chats: chat-root, chat-standalone, chat-shared  (3)
--
-- NOT accessible to user-1:
--   doc-deleted (deletedAt set), chat-deleted (deletedAt set),
--   doc-isolated, chat-isolated, project-isolated (no access)
--
-- User-2 accessible items (3 total):
--   project-isolated, doc-isolated, chat-isolated

SET session_replication_role = 'replica';

---------------------------------
-- BASE SETUP: USERS & ORG
---------------------------------

INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId")
VALUES ('macro|user-1@test.com', 'user1@test.com', 'stripe_id_1', 1),
       ('macro|user-2@test.com', 'user2@test.com', 'stripe_id_2', 1)
ON CONFLICT DO NOTHING;

---------------------------------
-- PROJECT HIERARCHY: root -> mid -> deep
---------------------------------

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES
  ('aa000001-ffff-ffff-ffff-ffffffffffff', 'Project Root', 'macro|user-1@test.com', NULL,
   '2024-01-10 10:00:00', '2024-02-10 10:00:00'),
  ('aa000002-ffff-ffff-ffff-ffffffffffff', 'Project Mid', 'macro|user-1@test.com', 'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-11 10:00:00', '2024-02-11 10:00:00'),
  ('aa000003-ffff-ffff-ffff-ffffffffffff', 'Project Deep', 'macro|user-1@test.com', 'aa000002-ffff-ffff-ffff-ffffffffffff',
   '2024-01-12 10:00:00', '2024-02-12 10:00:00'),
  -- Isolated project: user-1 has NO access, user-2 has owner
  ('aa000004-ffff-ffff-ffff-ffffffffffff', 'Project Isolated', 'macro|user-2@test.com', NULL,
   '2024-01-13 10:00:00', '2024-02-13 10:00:00');

---------------------------------
-- DOCUMENTS (10 total)
---------------------------------

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (101, 'bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (102, 'bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (103, 'bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (104, 'bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (105, 'bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (106, 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (107, 'bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (108, 'bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (109, 'bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (110, 'bb000010-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES
  -- doc-root-pdf: in root project, pdf, user-1
  ('bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Root Pdf', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 101, 'pdf',
   '2024-01-01 10:00:00', '2024-02-01 10:00:00', NULL),
  -- doc-mid-docx: in mid project, docx, user-1
  ('bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Mid Docx', 'macro|user-1@test.com',
   'aa000002-ffff-ffff-ffff-ffffffffffff', 102, 'docx',
   '2024-01-02 10:00:00', '2024-02-02 10:00:00', NULL),
  -- doc-deep-pdf: in deep project, pdf, user-1
  ('bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Deep Pdf', 'macro|user-1@test.com',
   'aa000003-ffff-ffff-ffff-ffffffffffff', 103, 'pdf',
   '2024-01-03 10:00:00', '2024-03-10 10:00:00', NULL),
  -- doc-standalone-txt: no project, txt, user-1
  ('bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Standalone Txt', 'macro|user-1@test.com',
   NULL, 104, 'txt',
   '2024-01-04 10:00:00', '2024-02-04 10:00:00', NULL),
  -- doc-deleted: in root, pdf, user-1, DELETED
  ('bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Deleted', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 105, 'pdf',
   '2024-01-15 10:00:00', '2024-02-15 10:00:00', '2024-03-01 10:00:00'),
  -- doc-task-completed: in root, txt, user-1, task, completed, assigned to user-1
  ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task Completed', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 106, 'txt',
   '2024-01-05 10:00:00', '2024-02-05 10:00:00', NULL),
  -- doc-task-incomplete: in root, txt, user-1, task, in-progress, assigned to other
  ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task Incomplete', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 107, 'txt',
   '2024-01-06 10:00:00', '2024-02-06 10:00:00', NULL),
  -- doc-task-no-status: in root, txt, user-1, task, no status, assigned to user-1
  ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task No Status', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 108, 'txt',
   '2024-01-07 10:00:00', '2024-02-07 10:00:00', NULL),
  -- doc-isolated: in isolated project, pdf, user-2
  ('bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Isolated', 'macro|user-2@test.com',
   'aa000004-ffff-ffff-ffff-ffffffffffff', 109, 'pdf',
   '2024-01-14 10:00:00', '2024-02-14 10:00:00', NULL),
  -- doc-shared-md: in root project, md, owned by user-2 (accessible to user-1 via project)
  ('bb000010-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Shared Md', 'macro|user-2@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 110, 'md',
   '2024-01-08 10:00:00', '2024-02-08 10:00:00', NULL);

INSERT INTO public."DocumentInstance" ("documentId", "sha")
VALUES ('bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-root-pdf'),
       ('bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-mid-docx'),
       ('bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-deep-pdf'),
       ('bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-standalone-txt'),
       ('bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-deleted'),
       ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-completed'),
       ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-incomplete'),
       ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-no-status'),
       ('bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-isolated'),
       ('bb000010-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-shared-md');

---------------------------------
-- CHATS (5 total)
---------------------------------

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt", "deletedAt")
VALUES
  -- chat-root: in root project, user-1
  ('cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Root', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-08 10:00:00', '2024-02-09 10:00:00', NULL),
  -- chat-standalone: no project, user-1
  ('cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Standalone', 'macro|user-1@test.com',
   NULL,
   '2024-01-09 10:00:00', '2024-03-11 10:00:00', NULL),
  -- chat-deleted: in root, user-1, DELETED
  ('cc000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Deleted', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-16 10:00:00', '2024-02-16 10:00:00', '2024-03-02 10:00:00'),
  -- chat-isolated: in isolated project, user-2
  ('cc000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Isolated', 'macro|user-2@test.com',
   'aa000004-ffff-ffff-ffff-ffffffffffff',
   '2024-01-17 10:00:00', '2024-02-17 10:00:00', NULL),
  -- chat-shared: in root project, owned by user-2 (accessible to user-1 via project)
  ('cc000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Shared', 'macro|user-2@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-18 10:00:00', '2024-02-18 10:00:00', NULL);

---------------------------------
-- TASK SUB-TYPES
---------------------------------

INSERT INTO public."document_sub_type" ("document_id", "sub_type")
VALUES ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
       ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
       ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task');

-- Entity properties: status + assignees
INSERT INTO public."entity_properties" ("id", "entity_id", "entity_type", "property_definition_id", "values")
VALUES
  -- Completed task: Status = Completed
  (gen_random_uuid(), 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000002',
   '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}'::jsonb),
  -- Incomplete task: Status = In Progress
  (gen_random_uuid(), 'bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000002',
   '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}'::jsonb),
  -- Completed task: assigned to user-1
  (gen_random_uuid(), 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000001',
   '{"type": "EntityReference", "value": [{"entity_id": "macro|user-1@test.com", "entity_type": "USER"}]}'::jsonb),
  -- Incomplete task: assigned to user-2
  (gen_random_uuid(), 'bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000001',
   '{"type": "EntityReference", "value": [{"entity_id": "macro|user-2@test.com", "entity_type": "USER"}]}'::jsonb),
  -- No-status task: assigned to user-1 (used by include_cbm_atm_nc path)
  (gen_random_uuid(), 'bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000001',
   '{"type": "EntityReference", "value": [{"entity_id": "macro|user-1@test.com", "entity_type": "USER"}]}'::jsonb);
-- No status property for doc-task-no-status (to test incomplete status fallback)

---------------------------------
-- USER ACCESS PERMISSIONS
---------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
  -- user-1: owner on project-root (inherits to mid, deep, and all items therein)
  (gen_random_uuid(), 'macro|user-1@test.com', 'aa000001-ffff-ffff-ffff-ffffffffffff', 'project', 'owner'),
  -- user-1: direct access to standalone items
  (gen_random_uuid(), 'macro|user-1@test.com', 'bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'owner'),
  (gen_random_uuid(), 'macro|user-1@test.com', 'cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'owner'),
  -- user-2: owner on isolated project
  (gen_random_uuid(), 'macro|user-2@test.com', 'aa000004-ffff-ffff-ffff-ffffffffffff', 'project', 'owner');

---------------------------------
-- USER HISTORY
-- Designed so all 4 sort methods produce different orderings.
-- Items WITHOUT history:
--   doc-deep-pdf (high updatedAt 2024-03-10, no history)
--   doc-task-incomplete (updatedAt 2024-02-06, no history)
--   chat-standalone (high updatedAt 2024-03-11, no history)
--   project-mid (updatedAt 2024-02-11, no history)
--   doc-shared-md (updatedAt 2024-02-08, no history)
--   chat-shared (updatedAt 2024-02-18, no history)
---------------------------------

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES
  -- doc-root-pdf: viewed_at = 2024-03-05
  ('macro|user-1@test.com', 'bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-05 10:00:00'),
  -- doc-mid-docx: viewed_at = 2024-03-08
  ('macro|user-1@test.com', 'bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-08 10:00:00'),
  -- doc-standalone-txt: viewed_at = 2024-03-06
  ('macro|user-1@test.com', 'bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-06 10:00:00'),
  -- doc-task-completed: viewed_at = 2024-03-04
  ('macro|user-1@test.com', 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-04 10:00:00'),
  -- doc-task-no-status: viewed_at = 2024-03-07
  ('macro|user-1@test.com', 'bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-07 10:00:00'),
  -- chat-root: viewed_at = 2024-03-03
  ('macro|user-1@test.com', 'cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat',
   '2024-01-01 00:00:00', '2024-03-03 10:00:00'),
  -- project-root: viewed_at = 2024-03-02
  ('macro|user-1@test.com', 'aa000001-ffff-ffff-ffff-ffffffffffff', 'project',
   '2024-01-01 00:00:00', '2024-03-02 10:00:00'),
  -- project-deep: viewed_at = 2024-03-01
  ('macro|user-1@test.com', 'aa000003-ffff-ffff-ffff-ffffffffffff', 'project',
   '2024-01-01 00:00:00', '2024-03-01 10:00:00');

---------------------------------
-- NOTIFICATIONS
-- Used by inbox-style done/seen backend filters.
---------------------------------

INSERT INTO public."notification" (
  "id",
  "notification_event_type",
  "event_item_id",
  "event_item_type",
  "service_sender",
  "metadata",
  "sender_id"
)
VALUES
  -- Document notifications
  ('dd000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '{}'::jsonb, 'macro|user-2@test.com'),
  ('dd000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '{}'::jsonb, 'macro|user-2@test.com'),
  -- Chat notifications
  ('dd000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'test', '{}'::jsonb, 'macro|user-2@test.com'),
  ('dd000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'cc000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'test', '{}'::jsonb, 'macro|user-1@test.com'),
  -- Project notifications
  ('dd000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'aa000001-ffff-ffff-ffff-ffffffffffff', 'project', 'test', '{}'::jsonb, 'macro|user-2@test.com'),
  ('dd000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'aa000003-ffff-ffff-ffff-ffffffffffff', 'project', 'test', '{}'::jsonb, 'macro|user-2@test.com');

INSERT INTO public."user_notification" ("user_id", "notification_id", "created_at", "seen_at", "done")
VALUES
  -- not done + unread
  ('macro|user-1@test.com', 'dd000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:00:00', NULL, false),
  ('macro|user-1@test.com', 'dd000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:01:00', NULL, false),
  ('macro|user-1@test.com', 'dd000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:02:00', NULL, false),
  -- done + seen
  ('macro|user-1@test.com', 'dd000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:03:00', '2024-03-09 11:00:00', true),
  ('macro|user-1@test.com', 'dd000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:04:00', '2024-03-09 11:01:00', true),
  ('macro|user-1@test.com', 'dd000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-03-09 10:05:00', '2024-03-09 11:02:00', true);

---------------------------------
-- FRECENCY RECORDS
-- doc-root-pdf and chat-root have frecency for user-1
---------------------------------

INSERT INTO public."frecency_aggregates" ("entity_id", "entity_type", "user_id", "event_count", "frecency_score", "first_event", "recent_events")
VALUES
  ('bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@test.com', 5, 10.0, '2024-01-01 10:00:00', '[]'::jsonb),
  ('cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@test.com', 3, 8.0, '2024-01-08 10:00:00', '[]'::jsonb);

SET session_replication_role = 'origin';
