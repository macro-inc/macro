INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Project" ("id", "name", "userId", "deletedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "deletedAt")
(SELECT 'p2', 'b', 'macro|user@user.com', 'p1', '2019-10-16 00:00:01');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "deletedAt")
(SELECT 'p3', 'c', 'macro|user@user.com', 'p2', '2019-10-16 00:00:02');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt", "projectId")
(SELECT 'd1', 'd1', 'docx', 'macro|user@user.com', '2019-10-16 00:00:03', 'p1');

INSERT INTO public."DocumentBom" ("id", "documentId")
(SELECT 1, 'd1');

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt", "projectId")
(SELECT 'd2', 'd2', 'pdf', 'macro|user@user.com', '2019-10-16 00:00:04', 'p2');

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha")
(SELECT 2, 'd2', 'sha');

INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt", "projectId")
(SELECT 'c1', 'c1', 'macro|user@user.com', '2019-10-16 00:00:05', 'p1');

INSERT INTO public."Chat" ("id", "name", "userId", "deletedAt", "projectId")
(SELECT 'c2', 'c2', 'macro|user@user.com', '2019-10-16 00:00:06', 'p2');
