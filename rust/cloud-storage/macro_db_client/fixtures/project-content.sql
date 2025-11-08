INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

-- Sub projects of project-one
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p2', 'a1', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p3', 'a2', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p4', 'a3', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p5', 'a3', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');


-- Sub projects of project-two
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p6', 'b1', 'macro|user@user.com', 'p2', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p7', 'b2', 'macro|user@user.com', 'p2', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

-- Sub projects of project-six
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p8', 'c1', 'macro|user@user.com', 'p6', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p9', 'd1', 'macro|user@user.com', 'p8', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p10', 'e1', 'macro|user@user.com', 'p9', '2019-10-16 00:00:00', '2019-10-16 01:00:00');

-- ensure we get item at the top level project
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'p1');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

-- ensure we get item in sub project
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'document-two', 'test_document_name','pdf', 'macro|user2@user.com', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'p6');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-two', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');

-- ensure we don't get item that should not be visible
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-three', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00');

-- ensure we get item at furthest depth
INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt", "projectId")
(SELECT 'chat-one', 'test-chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00', 'p10');


INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'document-one', 'sp-1');

INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-2', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'document-two', 'sp-2');
