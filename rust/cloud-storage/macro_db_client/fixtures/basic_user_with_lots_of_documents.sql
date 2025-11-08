INSERT INTO public."User" ("id","email","stripeCustomerId")
(SELECT 'macro|user@user.com', 'user@user.com','stripe_id');

INSERT INTO public."Project" ("id", "name", "userId")
(SELECT 'project-one', 'test_project_name', 'macro|user@user.com');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "projectId")
(SELECT 'document-one', 'test_document_name','txt', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'project-one');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-one', '2019-10-16 00:00:00', '2019-10-16 00:00:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-two', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:10:00', '2019-10-16 00:10:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-two', '2019-10-16 00:10:00', '2019-10-16 00:10:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-three', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:20:00', '2019-10-16 00:20:00');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt", "deletedAt")
(SELECT 'document-deleted', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:20:00', '2024-08-08 11:10:00', '2024-08-08 11:11:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-three', '2019-10-16 00:30:00', '2019-10-16 00:30:00', 'sha');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'chat-one', 'test-chat', 'macro|user@user.com', '2019-10-16 00:21:00', '2019-10-16 00:21:00');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-one', '"content1"', 'user');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-one', '"content2"', 'system');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-four', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:40:00', '2019-10-16 00:40:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-four', '2019-10-16 00:40:00', '2019-10-16 00:40:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-five', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 00:50:00', '2019-10-16 00:50:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-five', '2019-10-16 00:50:00', '2019-10-16 00:50:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-six', 'test_document_name','pdf', 'macro|user@user.com', '2019-10-16 01:00:00', '2019-10-16 01:00:00');

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "createdAt", "updatedAt", "sha")
(SELECT 'test_document_name', 'document-six', '2019-10-16 01:00:00', '2019-10-16 01:00:00', 'sha');

INSERT INTO public."Document" ("id","name","fileType", "owner", "createdAt", "updatedAt")
(SELECT 'document-seven', 'document-seven','docx', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."DocumentBom" ("revisionName", "documentId", "createdAt", "updatedAt")
(SELECT 'test_document_name', 'document-seven', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b1', 'sha-1', 'path', 1);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b2', 'sha-2', 'path', 1);
INSERT INTO public."BomPart" ("id", "sha", "path", "documentBomId")
(SELECT 'b3', 'sha-3', 'path', 1);

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'chat-two', 'test-chat', 'macro|user@user.com', '2019-10-16 01:02:00', '2019-10-16 01:02:00');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-two', '"content1"', 'user');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-two', '"content2"', 'system');

INSERT INTO public."Chat" ("id","name","userId", "createdAt", "updatedAt")
(SELECT 'chat-three', 'test-chat', 'macro|user@user.com', '2019-10-16 02:00:00', '2019-10-16 02:00:00');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-three', '"content1"', 'user');

INSERT INTO public."ChatMessage" ("chatId", "content", "role")
(SELECT 'chat-three', '"content2"', 'system');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-one', 'document', '2019-10-16 00:00:00', '2019-10-16 02:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-two', 'document', '2019-10-16 00:10:00', '2019-10-16 00:45:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-three', 'document', '2019-10-16 00:30:00', '2019-10-16 00:41:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-four', 'document', '2019-10-16 00:40:00', '2019-10-16 00:40:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-five', 'document', '2019-10-16 00:50:00', '2019-10-16 00:50:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-six', 'document', '2019-10-16 01:00:00', '2019-10-16 01:00:00');

INSERT INTO public."UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'chat-three', 'chat', '2019-10-16 03:00:00', '2019-10-16 03:00:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-one', 'document', 6, '2019-10-16 00:00:00', '2019-10-16 02:00:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-two', 'document', 2, '2019-10-16 00:10:00', '2019-10-16 00:45:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-three', 'document', 3, '2019-10-16 00:30:00', '2019-10-16 00:41:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-four', 'document', 4, '2019-10-16 00:40:00', '2019-10-16 00:40:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-five', 'document', 5, '2019-10-16 00:50:00', '2019-10-16 00:50:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'document-six', 'document', 1, '2019-10-16 01:00:00', '2019-10-16 01:00:00');

INSERT INTO public."Pin" ("userId", "pinnedItemId", "pinnedItemType", "pinIndex", "createdAt", "updatedAt")
(SELECT 'macro|user@user.com', 'project-one', 'project', 0, '2019-10-16 01:00:00', '2019-10-16 01:00:00');

-- Add UserItemAccess entries for documents owned by the user
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES 
    ('10000000-0000-0000-0000-000000000001', 'macro|user@user.com', 'document-one', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000002', 'macro|user@user.com', 'document-two', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000003', 'macro|user@user.com', 'document-three', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000004', 'macro|user@user.com', 'document-four', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000005', 'macro|user@user.com', 'document-five', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000006', 'macro|user@user.com', 'document-six', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000007', 'macro|user@user.com', 'document-seven', 'document', 'owner'),
    ('10000000-0000-0000-0000-000000000008', 'macro|user@user.com', 'project-one', 'project', 'owner');
