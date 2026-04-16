-- This fixture creates documents with task sub_type and entity_properties
-- to test the is_completed field in soup queries.
-- 
-- Documents:
-- - task-completed: Task with Status = "Completed" -> is_completed = true
-- - task-incomplete: Task with Status != "Completed" -> is_completed = false  
-- - task-no-status: Task with no Status property -> is_completed = false
-- - regular-doc: Regular document (not a task) -> is_completed = NULL

-- Disable foreign key constraints temporarily
SET session_replication_role = 'replica';

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES ('macro|user@user.com', 'user@user.com', 'stripe_id', 'a1111111-1111-1111-1111-111111111111');

-- Task with Status = "Completed"
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('11111111-1111-1111-1111-111111111111', 'Completed Task', 'txt', 'macro|user@user.com', '2024-01-01 10:00:00', '2024-01-02 11:00:00');

INSERT INTO public."document_sub_type" ("document_id", "sub_type")
VALUES ('11111111-1111-1111-1111-111111111111', 'task');

-- Task with Status != "Completed" (e.g., "In Progress")
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('22222222-2222-2222-2222-222222222222', 'Incomplete Task', 'txt', 'macro|user@user.com', '2024-01-01 11:00:00', '2024-01-02 12:00:00');

INSERT INTO public."document_sub_type" ("document_id", "sub_type")
VALUES ('22222222-2222-2222-2222-222222222222', 'task');

-- Task with no Status property
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('33333333-3333-3333-3333-333333333333', 'Task No Status', 'txt', 'macro|user@user.com', '2024-01-01 12:00:00', '2024-01-02 13:00:00');

INSERT INTO public."document_sub_type" ("document_id", "sub_type")
VALUES ('33333333-3333-3333-3333-333333333333', 'task');

-- Regular document (not a task)
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES ('44444444-4444-4444-4444-444444444444', 'Regular Document', 'pdf', 'macro|user@user.com', '2024-01-01 13:00:00', '2024-01-02 14:00:00');

-- Document instances (needed for the query to run)
INSERT INTO public."DocumentInstance" ("documentId", "sha")
VALUES ('11111111-1111-1111-1111-111111111111', 'sha-completed'),
       ('22222222-2222-2222-2222-222222222222', 'sha-incomplete'),
       ('33333333-3333-3333-3333-333333333333', 'sha-no-status'),
       ('44444444-4444-4444-4444-444444444444', 'sha-regular');

-- Give the user access to all documents
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES ('11111111-1111-1111-1111-111111111111', 'document', 'macro|user@user.com', 'user', 'owner'),
       ('22222222-2222-2222-2222-222222222222', 'document', 'macro|user@user.com', 'user', 'owner'),
       ('33333333-3333-3333-3333-333333333333', 'document', 'macro|user@user.com', 'user', 'owner'),
       ('44444444-4444-4444-4444-444444444444', 'document', 'macro|user@user.com', 'user', 'owner');

-- Entity properties: Status for completed task
-- Status property definition ID: '00000001-0000-0000-0000-000000000002'
-- Completed status option ID: '00000001-0000-0000-0002-000000000004'
INSERT INTO public."entity_properties" ("id", "entity_id", "entity_type", "property_definition_id", "values")
VALUES (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'TASK',
    '00000001-0000-0000-0000-000000000002',
    '{"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000004"]}'::jsonb
);

-- Entity properties: Status for incomplete task (e.g., "In Progress" option)
-- Using a different status option ID (assuming "In Progress" exists)
INSERT INTO public."entity_properties" ("id", "entity_id", "entity_type", "property_definition_id", "values")
VALUES (
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222',
    'TASK',
    '00000001-0000-0000-0000-000000000002',
    '{"type": "SelectOption", "value": ["00000001-0000-0000-0000-000000000001"]}'::jsonb
);

-- No entity_properties entry for task-no-status (to test false case)
-- No entity_properties entry for regular-doc (to test NULL case)

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';

