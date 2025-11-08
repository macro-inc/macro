INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user2@user.com', 'user2@user.com','stripe_id2');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-1', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'document-one', 'sp-1');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-two', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-two', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
(SELECT 'sp-2', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
(SELECT 'document-two', 'sp-2');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
(SELECT 'sp-1', 'channel-one', 'view');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
(SELECT 'sp-1', 'channel-two', 'edit');
