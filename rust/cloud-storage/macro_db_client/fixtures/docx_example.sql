INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentBom" ("revisionName", "documentId", "createdAt", "updatedAt")
(SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentBom" ("revisionName", "documentId", "createdAt", "updatedAt")
(SELECT 'test_document_name', 'document-one', '2019-10-16 01:00:00', '2019-10-16 01:00:00');

INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b1', 'sha-1', 'path', 1);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b2', 'sha-2', 'path', 1);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b3', 'sha-3', 'path', 1);

INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b4', 'sha-1', 'path', 2);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b5', 'sha-2', 'path', 2);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b6', 'sha-4', 'path', 2);
