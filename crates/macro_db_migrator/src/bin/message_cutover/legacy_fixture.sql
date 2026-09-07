INSERT INTO macro_user(id, username, email, stripe_customer_id)
VALUES ('01990000-0000-7000-8000-000000000001', 'migration', 'migration@example.com', 'migration');
INSERT INTO "User"(id, email, macro_user_id)
VALUES ('macro|migration@example.com', 'migration@example.com', '01990000-0000-7000-8000-000000000001');
INSERT INTO comms_channels(id, name, channel_type, owner_id)
VALUES ('01990000-0000-7000-8000-000000000005', 'Existing channel', 'private', 'macro|migration@example.com');
INSERT INTO comms_messages(id, channel_id, thread_id, sender_id, content) VALUES
    ('01990000-0000-7000-8000-000000000006', '01990000-0000-7000-8000-000000000005', null, 'macro|migration@example.com', 'Channel root'),
    ('01990000-0000-7000-8000-000000000007', '01990000-0000-7000-8000-000000000005', '01990000-0000-7000-8000-000000000006', 'macro|migration@example.com', 'Channel reply');
INSERT INTO "Document"(id, name, owner, "fileType") VALUES
    ('legacy-md', 'Legacy', 'macro|migration@example.com', 'md'),
    ('legacy-pdf', 'Legacy PDF', 'macro|migration@example.com', 'pdf');
INSERT INTO "Thread"(id, owner, "documentId", resolved, metadata) VALUES
    (1, 'macro|migration@example.com', 'legacy-md', true, '{"markId":"01990000-0000-7000-8000-000000000002"}'),
    (2, 'macro|migration@example.com', 'legacy-md', false, '{"markId":"DISCUSSION:legacy"}'),
    (3, 'macro|migration@example.com', 'legacy-pdf', false, '{}'),
    (4, 'macro|migration@example.com', 'legacy-pdf', false, '{}');
INSERT INTO "Comment"(id, "threadId", owner, sender, text, "order", "createdAt", "deletedAt") VALUES
    (10, 1, 'macro|migration@example.com', 'Original author', 'Deleted root', 1, '2020-01-01', '2020-01-03'),
    (11, 1, 'macro|migration@example.com', null, 'Surviving reply', 2, '2020-01-02', null),
    (12, 3, 'macro|migration@example.com', 'PDF Author', 'PDF original', 1, '2020-01-01', null),
    (13, 4, 'macro|migration@example.com', null, 'Highlight comment', 1, '2020-01-01', null);
INSERT INTO "PdfPlaceableCommentAnchor"(
    uuid, "documentId", owner, page, "wasEdited", "wasDeleted", "shouldLockOnSave",
    "originalPage", "originalIndex", "xPct", "yPct", "widthPct", "heightPct", rotation, "threadId"
) VALUES ('01990000-0000-7000-8000-000000000003', 'legacy-pdf', 'macro|migration@example.com',
    2, false, false, false, 2, 0, 0.1, 0.2, 0.3, 0.4, 0, 3);
INSERT INTO "PdfHighlightAnchor"(
    uuid, "documentId", owner, page, red, green, blue, alpha, type, text,
    "pageViewportWidth", "pageViewportHeight", "threadId"
) VALUES ('01990000-0000-7000-8000-000000000004', 'legacy-pdf', 'macro|migration@example.com',
    1, 255, 255, 0, 0.5, 0, 'Highlighted text', 600, 800, 4);
INSERT INTO "PdfHighlightRect"(top, "left", width, height, "pdfHighlightAnchorId")
VALUES (0.1, 0.2, 0.3, 0.4, '01990000-0000-7000-8000-000000000004');
INSERT INTO "DocumentInstance"(id, "documentId", sha) VALUES (1, 'legacy-pdf', 'fixture');
INSERT INTO "DocumentInstanceModificationData"("documentInstanceId", "modificationData")
VALUES (1, '{"pages":[{"highlights":[{"comments":[{"id":12,"text":"PDF original"},{"id":"external-pdf-id","text":"External"}]}]}]}');
INSERT INTO notification(id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
SELECT gen_random_uuid(), kind, 'legacy-md', 'document', 'dss',
    '{"commentId":11,"threadId":1,"commentText":"Surviving reply"}'::jsonb
FROM unnest(ARRAY['commented_on_document', 'replied_to_document_comment_thread', 'mentioned_in_document_comment']) kind;
