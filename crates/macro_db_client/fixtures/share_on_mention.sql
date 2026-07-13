-- Fixture for share_on_mention tests: a public document and a private document,
-- each with a SharePermission/DocumentPermission link. Document ids are real
-- UUIDs because entity_access.entity_id is a UUID column.

INSERT INTO public."Organization" ("id", "name")
VALUES (1, 'organization-one');

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'owner', 'owner@user.com', 'stripe_owner');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES (
    'macro|owner@user.com',
    'owner@user.com',
    'stripe_owner',
    1,
    'a1111111-1111-1111-1111-111111111111'
);

-- Public document (anyone can comment).
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Public Doc',
    'pdf',
    'macro|owner@user.com',
    '2022-01-01 00:00:00',
    '2022-01-01 00:00:00'
);

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('sp-public', true, 'comment', '2022-01-01 00:00:00', '2022-01-01 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('11111111-1111-1111-1111-111111111111', 'sp-public');

-- Private document (not public).
INSERT INTO public."Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES (
    '22222222-2222-2222-2222-222222222222',
    'Private Doc',
    'pdf',
    'macro|owner@user.com',
    '2022-01-01 00:00:00',
    '2022-01-01 00:00:00'
);

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('sp-private', false, NULL, '2022-01-01 00:00:00', '2022-01-01 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('22222222-2222-2222-2222-222222222222', 'sp-private');
