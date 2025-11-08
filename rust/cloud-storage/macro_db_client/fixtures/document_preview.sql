INSERT INTO public."User" ("id","email","stripeCustomerId")
VALUES ('macro|user@user.com', 'user@user.com','stripe_id');
INSERT INTO public."User" ("id","email","stripeCustomerId")
VALUES ('macro|other@user.com', 'other@user.com','stripe_iddfkjdfkdf');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
VALUES ('document-one', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('share-permission-one', true, 'view', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('document-one', 'share-permission-one');

INSERT INTO public."DocumentInstance" ("id", "revisionName", "documentId", "createdAt", "updatedAt", "sha")
VALUES (1, 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
VALUES ('macro|user@user.com', 'document-one', 'document', 0, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

-- Create document two with permissions
INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
VALUES ('document-two', 'test_document_name','pdf', 'macro|other@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
VALUES ('share-permission-two', false, NULL, '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('document-two', 'share-permission-two');

INSERT INTO public."DocumentInstance" ("id", "revisionName", "documentId", "createdAt", "updatedAt", "sha")
VALUES (2, 'test_document_name', 'document-two', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
VALUES ('share-permission-one', 'c1', 'view');

INSERT INTO public."ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
VALUES ('share-permission-one', 'c2', 'edit');
