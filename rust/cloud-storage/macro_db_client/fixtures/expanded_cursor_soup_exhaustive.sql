-- Exhaustive fixture for expanded_generic_cursor_soup tests.
--
-- Covers:
--   - 3-level deep project hierarchy (root -> mid -> deep)
--   - Deleted items (doc + chat) that must be excluded
--   - Task documents with completed/incomplete/no-status states
--   - Isolated project with no access for user-1
--   - Second user for access isolation testing
--   - Standalone items (no project) with direct access
--   - Distinct timestamps for createdAt, updatedAt, and UserHistory.updatedAt
--     so all four sort methods (viewed_at, updated_at, created_at, viewed_updated)
--     produce different orderings.
--
-- User-1 accessible items (11 total):
--   Projects: project-root, project-mid, project-deep
--   Documents: doc-in-root, doc-in-mid, doc-in-deep, doc-standalone,
--              doc-task-completed, doc-task-incomplete, doc-task-no-status
--   Chats: chat-in-root, chat-standalone
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

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1', 'user1@test.com', 'stripe_id_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@test.com', 'stripe_id_2');
INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@test.com', 'user1@test.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111'),
       ('macro|user-2@test.com', 'user2@test.com', 'stripe_id_2', 1, 'a2222222-2222-2222-2222-222222222222')
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
-- DOCUMENTS
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
       (109, 'bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES
  -- Normal documents in hierarchy
  ('bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc In Root', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 101, 'pdf',
   '2024-01-01 10:00:00', '2024-02-01 10:00:00', NULL),
  ('bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc In Mid', 'macro|user-1@test.com',
   'aa000002-ffff-ffff-ffff-ffffffffffff', 102, 'docx',
   '2024-01-02 10:00:00', '2024-02-02 10:00:00', NULL),
  ('bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc In Deep', 'macro|user-1@test.com',
   'aa000003-ffff-ffff-ffff-ffffffffffff', 103, 'pdf',
   '2024-01-03 10:00:00', '2024-03-10 10:00:00', NULL),
  -- Standalone document (no project, direct access)
  ('bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Standalone', 'macro|user-1@test.com',
   NULL, 104, 'txt',
   '2024-01-04 10:00:00', '2024-02-04 10:00:00', NULL),
  -- Deleted document (should be excluded)
  ('bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Deleted', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 105, 'pdf',
   '2024-01-15 10:00:00', '2024-02-15 10:00:00', '2024-03-01 10:00:00'),
  -- Task documents for is_completed testing
  ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task Completed', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 106, 'txt',
   '2024-01-05 10:00:00', '2024-02-05 10:00:00', NULL),
  ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task Incomplete', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 107, 'txt',
   '2024-01-06 10:00:00', '2024-02-06 10:00:00', NULL),
  ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Task No Status', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff', 108, 'txt',
   '2024-01-07 10:00:00', '2024-02-07 10:00:00', NULL),
  -- Isolated document (in isolated project, user-1 has NO access)
  ('bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc Isolated', 'macro|user-2@test.com',
   'aa000004-ffff-ffff-ffff-ffffffffffff', 109, 'pdf',
   '2024-01-14 10:00:00', '2024-02-14 10:00:00', NULL);

INSERT INTO public."DocumentInstance" ("documentId", "sha")
VALUES ('bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-root'),
       ('bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-mid'),
       ('bb000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-deep'),
       ('bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-standalone'),
       ('bb000005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-deleted'),
       ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-completed'),
       ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-incomplete'),
       ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-task-no-status'),
       ('bb000009-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-isolated');

---------------------------------
-- CHATS
---------------------------------

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt", "deletedAt")
VALUES
  ('cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat In Root', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-08 10:00:00', '2024-02-08 10:00:00', NULL),
  ('cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Standalone', 'macro|user-1@test.com',
   NULL,
   '2024-01-09 10:00:00', '2024-03-11 10:00:00', NULL),
  -- Deleted chat (should be excluded)
  ('cc000003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Deleted', 'macro|user-1@test.com',
   'aa000001-ffff-ffff-ffff-ffffffffffff',
   '2024-01-16 10:00:00', '2024-02-16 10:00:00', '2024-03-02 10:00:00'),
  -- Isolated chat (in isolated project, user-1 has NO access)
  ('cc000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat Isolated', 'macro|user-2@test.com',
   'aa000004-ffff-ffff-ffff-ffffffffffff',
   '2024-01-17 10:00:00', '2024-02-17 10:00:00', NULL);

---------------------------------
-- TASK SUB-TYPES
---------------------------------

INSERT INTO public."document_sub_type" ("document_id", "sub_type")
VALUES ('bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
       ('bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
       ('bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task');

-- Entity properties: Status for completed task
-- Status property definition ID: '00000001-0000-0000-0000-000000000002'
-- Completed status option ID: '00000001-0000-0000-0002-000000000004'
INSERT INTO public."entity_properties" ("id", "entity_id", "entity_type", "property_definition_id", "values")
VALUES
  -- Completed task: Status = Completed
  (gen_random_uuid(), 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000002',
   '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}'::jsonb),
  -- Incomplete task: Status = In Progress
  (gen_random_uuid(), 'bb000007-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
   '00000001-0000-0000-0000-000000000002',
   '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000002"]}'::jsonb);
-- No entity_properties for doc-task-no-status (to test false case)

---------------------------------
-- USER ACCESS PERMISSIONS
---------------------------------

INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
  -- user-1: owner on project-root (inherits to mid and deep)
  (gen_random_uuid(), 'macro|user-1@test.com', 'aa000001-ffff-ffff-ffff-ffffffffffff', 'project', 'owner'),
  -- user-1: direct access to standalone items
  (gen_random_uuid(), 'macro|user-1@test.com', 'bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'owner'),
  (gen_random_uuid(), 'macro|user-1@test.com', 'cc000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'owner'),
  -- user-2: owner on isolated project
  (gen_random_uuid(), 'macro|user-2@test.com', 'aa000004-ffff-ffff-ffff-ffffffffffff', 'project', 'owner');

---------------------------------
-- USER HISTORY
-- Some items have history, some don't, to test viewed_at vs viewed_updated differences.
-- Items WITHOUT history but with high updatedAt will rank differently
-- under viewed_updated vs viewed_at sort.
---------------------------------

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
VALUES
  -- doc-in-root: viewed_at = 2024-03-05
  ('macro|user-1@test.com', 'bb000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-05 10:00:00'),
  -- doc-in-mid: viewed_at = 2024-03-08 (most recently viewed doc)
  ('macro|user-1@test.com', 'bb000002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-08 10:00:00'),
  -- doc-in-deep: NO HISTORY (but updatedAt = 2024-03-10, very recent)
  -- doc-standalone: viewed_at = 2024-03-06
  ('macro|user-1@test.com', 'bb000004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-06 10:00:00'),
  -- doc-task-completed: viewed_at = 2024-03-04
  ('macro|user-1@test.com', 'bb000006-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-04 10:00:00'),
  -- doc-task-incomplete: NO HISTORY
  -- doc-task-no-status: viewed_at = 2024-03-07
  ('macro|user-1@test.com', 'bb000008-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document',
   '2024-01-01 00:00:00', '2024-03-07 10:00:00'),
  -- chat-in-root: viewed_at = 2024-03-03
  ('macro|user-1@test.com', 'cc000001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat',
   '2024-01-01 00:00:00', '2024-03-03 10:00:00'),
  -- chat-standalone: NO HISTORY (but updatedAt = 2024-03-11, highest)
  -- project-root: viewed_at = 2024-03-02
  ('macro|user-1@test.com', 'aa000001-ffff-ffff-ffff-ffffffffffff', 'project',
   '2024-01-01 00:00:00', '2024-03-02 10:00:00'),
  -- project-mid: NO HISTORY
  -- project-deep: viewed_at = 2024-03-01
  ('macro|user-1@test.com', 'aa000003-ffff-ffff-ffff-ffffffffffff', 'project',
   '2024-01-01 00:00:00', '2024-03-01 10:00:00');

SET session_replication_role = 'origin';
