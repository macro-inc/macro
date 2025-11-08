INSERT INTO public."User" ("id","email","stripeCustomerId")
VALUES 
('macro|user@user.com', 'user@user.com','stripe_id'),
('macro|user2@user.com', 'user2@user.com','stripe_id2');


-- Make projects
INSERT INTO public."Project" ("id","name","userId","createdAt","updatedAt", "parentId")
VALUES
('p1', 'test_project_name','macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', NULL),
('p2', 'test_project_name','macro|user2@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'p1');

-- Make project share permissions
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES
('sp-p1', true, 'edit', '2019-10-16 00:00:00', '2019-10-16 00:00:00'),
('sp-p2', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES
('p1', 'sp-p1'),
('p2', 'sp-p2');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
VALUES
('sp-p1', 'c1', 'view'),
('sp-p1', 'c2', 'edit');


-- Make documents
INSERT INTO public."Document" ("id","name","owner", "fileType", "projectId")
VALUES
('d1', 'test_document_name','macro|user@user.com', 'docx', NULL),
('d2', 'test_document_name','macro|user2@user.com', 'pdf', 'p2');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
VALUES
('sp-d1', true, 'edit'),
('sp-d2', false, NULL);

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES
('d1', 'sp-d1'),
('d2', 'sp-d2');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
VALUES
('sp-d1', 'c1', 'view'),
('sp-d1', 'c2', 'edit');


-- Make chats
INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt", "projectId")
VALUES
('c1', 'test_chat_name','macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', NULL),
('c2', 'test_chat_name','macro|user2@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'p2');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES
('sp-c1', true, 'edit', '2019-10-16 00:00:00', '2019-10-16 00:00:00'),
('sp-c2', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
VALUES
('c1', 'sp-c1'),
('c2', 'sp-c2');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
VALUES
('sp-c1', 'c1', 'view'),
('sp-c1', 'c2', 'edit');
