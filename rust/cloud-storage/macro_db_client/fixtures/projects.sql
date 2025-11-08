INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'p1', 'a', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-project1', false, 'view', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p1', 'sp-project1');

INSERT INTO public."Project" ("id", "name", "userId", "createdAt", "updatedAt")
(SELECT 'pb1', 'b', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-projectb1', true, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'pb1', 'sp-projectb1');

-- Sub projects of p1
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p2', 'a1', 'macro|user2@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project2', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p2', 'sp-project2');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p3', 'a2', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project3', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p3', 'sp-project3');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p4', 'a3', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project4', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p4', 'sp-project4');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p5', 'a4', 'macro|user@user.com', 'p1', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project5', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p5', 'sp-project5');


-- Sub projects of p2
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p6', 'b1', 'macro|user@user.com', 'p2', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project6', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p6', 'sp-project6');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p7', 'b2', 'macro|user@user.com', 'p2', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project7', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p7', 'sp-project7');

-- Sub projects of project-six
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p8', 'c1', 'macro|user@user.com', 'p6', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project8', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p8', 'sp-project8');

-- Project 9 is a project user does not have access to
INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p9', 'd1', 'macro|user@user.com', 'p8', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project9', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p9', 'sp-project9');

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
(SELECT 'p10', 'e1', 'macro|user@user.com', 'p9', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
(SELECT 'sp-project10', false, 'view');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p10', 'sp-project10');


INSERT INTO public."Project" ("id", "name", "userId", "parentId")
(SELECT 'p11', 'f1', 'macro|user2@user.com', 'p2');
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-project11', true, 'view', '2019-10-16 00:00:00', '2019-10-16 01:00:00');
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
(SELECT 'p11', 'sp-project11');
