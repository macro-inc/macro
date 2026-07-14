INSERT INTO public."Organization" ("id", "name")
    VALUES (1, 'test-org');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
    VALUES ('a1111111-1111-1111-1111-111111111111', 'testuser', 'testuser@test.com', 'stripe_test');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
    VALUES ('macro|testuser@test.com', 'testuser@test.com', 'stripe_test', 1, 'a1111111-1111-1111-1111-111111111111');

-- Root project (no parent)
INSERT INTO public."Project" ("id", "name", "userId")
    VALUES ('11111111-1111-1111-1111-111111111111', 'root-project', 'macro|testuser@test.com');

-- Child project (parent = root)
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
    VALUES ('22222222-2222-2222-2222-222222222222', 'child-project', 'macro|testuser@test.com', '11111111-1111-1111-1111-111111111111');

-- Grandchild project (parent = child)
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
    VALUES ('33333333-3333-3333-3333-333333333333', 'grandchild-project', 'macro|testuser@test.com', '22222222-2222-2222-2222-222222222222');

-- entity_access: direct share — user has edit on root project
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('11111111-1111-1111-1111-111111111111', 'project', 'macro|testuser@test.com', 'user', 'edit');

-- entity_access: direct share — team has view on root project
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('11111111-1111-1111-1111-111111111111', 'project', 'team-one', 'team', 'view');

-- entity_access: direct share — channel has comment on child project
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('22222222-2222-2222-2222-222222222222', 'project', 'channel-one', 'channel', 'comment');

-- entity_access: inherited access (has granted_from_project_id) — should be excluded by query
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
    VALUES ('22222222-2222-2222-2222-222222222222', 'project', 'macro|testuser@test.com', 'user', 'view', '11111111-1111-1111-1111-111111111111');

-- entity_access: wrong entity_type (document, not project) — should be excluded by query
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
    VALUES ('11111111-1111-1111-1111-111111111111', 'document', 'macro|testuser@test.com', 'user', 'view');
