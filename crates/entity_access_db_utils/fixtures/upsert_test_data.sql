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

-- Empty project (no children, used to test the no-children edge case)
INSERT INTO public."Project" ("id", "name", "userId")
    VALUES ('33333333-3333-3333-3333-333333333333', 'empty-project', 'macro|testuser@test.com');

-- Document under root
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
    VALUES ('44444444-4444-4444-4444-444444444444', 'doc-root', 'macro|testuser@test.com', '11111111-1111-1111-1111-111111111111');

-- Document under child
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
    VALUES ('55555555-5555-5555-5555-555555555555', 'doc-child', 'macro|testuser@test.com', '22222222-2222-2222-2222-222222222222');

-- Chat under child
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
    VALUES ('66666666-6666-6666-6666-666666666666', 'chat-child', 'macro|testuser@test.com', '22222222-2222-2222-2222-222222222222');

-- Standalone chat under root (used for single-entity upsert tests)
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
    VALUES ('77777777-7777-7777-7777-777777777777', 'chat-root', 'macro|testuser@test.com', '11111111-1111-1111-1111-111111111111');
