INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd1', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'p1');
INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'd1', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-document1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd1', 'sp-document1');

-- ensure we get item in sub project
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd2', 'test_document_name','docx', 'macro|user2@user.com', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'p6');
INSERT INTO public."DocumentBom" ("documentId", "createdAt", "updatedAt")
(SELECT 'd2', '2019-10-16 00:10:00', '2019-10-16 00:10:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-document2', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd2', 'sp-document2');

-- ensure we don't get item that should not be visible
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd3', 'test_document_name','md', 'macro|user2@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00', 'p1');
INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'd3', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-document3', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd3', 'sp-document3');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd4', 'test_document_name','md', 'macro|user@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00', 'p11');
INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'd4', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-document4', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd4', 'sp-document4');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'd5', 'test_document_name','md', 'macro|user2@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00', 'p11');
INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'd5', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');
INSERT INTO public."SharePermission" ("id", "isPublic", "createdAt", "updatedAt")
(SELECT 'sp-document5', false, '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'd5', 'sp-document5');
