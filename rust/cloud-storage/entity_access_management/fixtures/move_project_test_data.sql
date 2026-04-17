INSERT INTO public."Organization" ("id", "name")
    VALUES (1, 'test-org');

-- Four users
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id") VALUES
    ('a1111111-1111-1111-1111-111111111111', 'user_a', 'user_a@test.com', 'stripe_a'),
    ('a2222222-2222-2222-2222-222222222222', 'user_b', 'user_b@test.com', 'stripe_b'),
    ('a3333333-3333-3333-3333-333333333333', 'user_c', 'user_c@test.com', 'stripe_c'),
    ('a4444444-4444-4444-4444-444444444444', 'user_d', 'user_d@test.com', 'stripe_d');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id") VALUES
    ('macro|user_a@test.com', 'user_a@test.com', 'stripe_a', 1, 'a1111111-1111-1111-1111-111111111111'),
    ('macro|user_b@test.com', 'user_b@test.com', 'stripe_b', 1, 'a2222222-2222-2222-2222-222222222222'),
    ('macro|user_c@test.com', 'user_c@test.com', 'stripe_c', 1, 'a3333333-3333-3333-3333-333333333333'),
    ('macro|user_d@test.com', 'user_d@test.com', 'stripe_d', 1, 'a4444444-4444-4444-4444-444444444444');

-- PROJECT_A (root, owner UA) — source parent
INSERT INTO public."Project" ("id", "name", "userId")
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project-a', 'macro|user_a@test.com');

-- PROJECT_B (child of A, owner UB) — the project being moved
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project-b', 'macro|user_b@test.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- PROJECT_C (child of B, owner UC) — nested under B
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project-c', 'macro|user_c@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- PROJECT_D (root, owner UD) — destination parent
INSERT INTO public."Project" ("id", "name", "userId")
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'project-d', 'macro|user_d@test.com');

-- Documents with UUID ids (required for move_project's Uuid::parse_str)
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
    VALUES ('d1111111-1111-1111-1111-111111111111', 'doc-in-b', 'macro|user_b@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
    VALUES ('d2222222-2222-2222-2222-222222222222', 'doc-in-c', 'macro|user_c@test.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

---------------------------------------------------------------------------
-- entity_access: direct project shares (granted_from_project_id IS NULL)
---------------------------------------------------------------------------

-- project_a: user_a/owner, channel-1/view
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'macro|user_a@test.com', 'user', 'owner');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'channel-1', 'channel', 'view');

-- project_b: user_b/owner, team-1/edit
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'macro|user_b@test.com', 'user', 'owner');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'team-1', 'team', 'edit');

-- project_c: user_c/owner
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project', 'macro|user_c@test.com', 'user', 'owner');

-- project_d: user_d/owner, team-2/comment
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'project', 'macro|user_d@test.com', 'user', 'owner');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'project', 'team-2', 'team', 'comment');

---------------------------------------------------------------------------
-- entity_access: inherited project shares
---------------------------------------------------------------------------

-- project_b inherited from project_a
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'macro|user_a@test.com', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'project', 'channel-1', 'channel', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- project_c inherited from project_a
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project', 'macro|user_a@test.com', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project', 'channel-1', 'channel', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- project_c inherited from project_b
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project', 'macro|user_b@test.com', 'user', 'owner', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'project', 'team-1', 'team', 'edit', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

---------------------------------------------------------------------------
-- entity_access: doc_in_b access (as if add_entity_to_project was called for project_b)
-- walk_up(B) = [B, A] → sources: user_a/owner(A), channel-1/view(A), user_b/owner(B), team-1/edit(B)
---------------------------------------------------------------------------
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d1111111-1111-1111-1111-111111111111', 'document', 'macro|user_a@test.com', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d1111111-1111-1111-1111-111111111111', 'document', 'channel-1', 'channel', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d1111111-1111-1111-1111-111111111111', 'document', 'macro|user_b@test.com', 'user', 'owner', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d1111111-1111-1111-1111-111111111111', 'document', 'team-1', 'team', 'edit', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

---------------------------------------------------------------------------
-- entity_access: doc_in_c access (as if add_entity_to_project was called for project_c)
-- walk_up(C) = [C, B, A] → sources: user_a/owner(A), channel-1/view(A), user_b/owner(B), team-1/edit(B), user_c/owner(C)
---------------------------------------------------------------------------
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d2222222-2222-2222-2222-222222222222', 'document', 'macro|user_a@test.com', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d2222222-2222-2222-2222-222222222222', 'document', 'channel-1', 'channel', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d2222222-2222-2222-2222-222222222222', 'document', 'macro|user_b@test.com', 'user', 'owner', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d2222222-2222-2222-2222-222222222222', 'document', 'team-1', 'team', 'edit', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('d2222222-2222-2222-2222-222222222222', 'document', 'macro|user_c@test.com', 'user', 'owner', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
