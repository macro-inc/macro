-- Fixture for list_documents_with_access tests.
-- Uses UUID-format document IDs since entity_access.entity_id is UUID type.

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId","macro_user_id")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id','a1111111-1111-1111-1111-111111111111');

INSERT INTO public."Project" ("id", "name", "userId")
(SELECT 'dddddddd-0000-0000-0000-100000000000', 'test_project_name', 'macro|user@user.com');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'dddddddd-0000-0000-0000-000000000001', 'test_document_name','txt', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'dddddddd-0000-0000-0000-100000000000');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000001', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000002', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:10:00', '2019-10-16 00:10:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000002', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000003', 'test_document_name','md', 'macro|user@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "deletedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000099', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:20:00', '2024-08-08 11:10:00', '2024-08-08 11:11:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000003', '2019-10-16 00:30:00', '2019-10-16 00:30:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000004', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:40:00', '2019-10-16 00:40:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000004', '2019-10-16 00:40:00', '2019-10-16 00:40:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000005', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:50:00', '2019-10-16 00:50:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000005', '2019-10-16 00:50:00', '2019-10-16 00:50:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'dddddddd-0000-0000-0000-000000000006', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 01:00:00', '2019-10-16 01:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'dddddddd-0000-0000-0000-000000000006', '2019-10-16 01:00:00', '2019-10-16 01:00:00', 'sha');

-- entity_access entries for documents owned by the user
INSERT INTO public.entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES
    ('dddddddd-0000-0000-0000-000000000001', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-000000000002', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-000000000003', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-000000000004', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-000000000005', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-000000000006', 'document', 'macro|user@user.com', 'user', 'owner'),
    ('dddddddd-0000-0000-0000-100000000000', 'project', 'macro|user@user.com', 'user', 'owner');
