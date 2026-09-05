-- Shared message threads and annotation geometry. Each anchor owns one root.
INSERT INTO macro_user(id, username, email, stripe_customer_id)
VALUES ('a1111111-1111-1111-1111-111111111111', 'user', 'user@user.com', 'stripe_id'),
       ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@user.com', 'stripe_id2');
INSERT INTO "User"(id, email, macro_user_id)
VALUES ('macro|user@user.com', 'user@user.com', 'a1111111-1111-1111-1111-111111111111'),
       ('macro|user2@user.com', 'user2@user.com', 'a2222222-2222-2222-2222-222222222222');
INSERT INTO "Document"(id, name, "fileType", owner)
VALUES ('document-with-comments', 'Annotated PDF', 'pdf', 'macro|user@user.com'),
       ('empty-document', 'Empty PDF', 'pdf', 'macro|user@user.com');
INSERT INTO "DocumentInstance"(id, "documentId", sha)
VALUES (100, 'document-with-comments', 'sha-comments'), (200, 'empty-document', 'sha-empty');
INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, imported_author, content, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'document', 'document-with-comments', 'macro|user@user.com', 'Original PDF author', 'Initial question on page 1', '2022-01-10T10:00:00Z', '2022-01-10T10:00:00Z'),
       ('00000000-0000-0000-0000-000000000002', 'document', 'document-with-comments', 'macro|user@user.com', NULL, 'Resolved placeable', '2022-01-10T11:00:00Z', '2022-01-10T11:00:00Z'),
       ('00000000-0000-0000-0000-000000000003', 'document', 'document-with-comments', 'macro|user@user.com', NULL, 'Third placeable', '2022-01-10T12:00:00Z', '2022-01-10T12:00:00Z'),
       ('00000000-0000-0000-0000-000000000004', 'document', 'document-with-comments', 'macro|user@user.com', NULL, 'Highlight discussion', '2022-01-10T13:00:00Z', '2022-01-10T13:00:00Z');
INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, thread_id, sender_id, content, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000011', 'document', 'document-with-comments', '00000000-0000-0000-0000-000000000001', 'macro|user2@user.com', 'Reply from a collaborator', '2022-01-10T14:00:00Z', '2022-01-10T14:00:00Z');
INSERT INTO "PdfPlaceableCommentAnchor"(uuid, "documentId", owner, "threadId", page, "originalPage", "originalIndex", "shouldLockOnSave", "xPct", "yPct", "widthPct", "heightPct", rotation, "wasEdited", "wasDeleted", "allowableEdits")
VALUES ('91111111-1111-1111-1111-111111111111', 'document-with-comments', 'macro|user@user.com', '00000000-0000-0000-0000-000000000001', 1, 1, 0, true, 0.2, 0.3, 0.1, 0.05, 0, false, false, '{"allowResize":true,"allowTranslate":true,"allowRotate":true,"allowDelete":true,"lockAspectRatio":false}'),
       ('81111111-1111-1111-1111-111111111111', 'document-with-comments', 'macro|user@user.com', '00000000-0000-0000-0000-000000000002', 2, 2, 1, false, 0.5, 0.6, 0.15, 0.07, 0, false, false, NULL),
       ('71111111-1111-1111-1111-111111111111', 'document-with-comments', 'macro|user@user.com', '00000000-0000-0000-0000-000000000003', 3, 3, 2, true, 0.7, 0.4, 0.12, 0.06, 0, true, false, NULL);
UPDATE comms_message_threads t SET anchor = jsonb_build_object('type', 'pdf_placeable', 'anchor_id', a.uuid)
FROM "PdfPlaceableCommentAnchor" a WHERE t.root_id = a."threadId";
UPDATE comms_message_threads SET resolved = true WHERE root_id = '00000000-0000-0000-0000-000000000002';
INSERT INTO "PdfHighlightAnchor"(uuid, "documentId", owner, "threadId", page, red, green, blue, alpha, type, text, "pageViewportWidth", "pageViewportHeight")
VALUES ('11111111-1111-1111-1111-111111111111', 'document-with-comments', 'macro|user@user.com', '00000000-0000-0000-0000-000000000004', 1, 255, 255, 0, 0.5, 1, 'Highlighted sentence', 600, 800),
       ('33333333-3333-3333-3333-333333333333', 'document-with-comments', 'macro|user@user.com', NULL, 2, 255, 0, 0, 1, 2, 'Standalone underline', 600, 800);
INSERT INTO "PdfHighlightRect"("pdfHighlightAnchorId", top, "left", width, height)
VALUES ('11111111-1111-1111-1111-111111111111', 0.2, 0.1, 0.5, 0.02),
       ('33333333-3333-3333-3333-333333333333', 0.3, 0.2, 0.4, 0.02);
UPDATE comms_message_threads SET anchor = '{"type":"pdf_highlight","anchor_id":"11111111-1111-1111-1111-111111111111"}'
WHERE root_id = '00000000-0000-0000-0000-000000000004';
