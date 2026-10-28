INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES ('019a0000-0000-7000-8000-000000000001', 'drop-test', 'drop@example.com', 'drop-test');
INSERT INTO "User" (id, email, macro_user_id)
VALUES ('macro|drop@example.com', 'drop@example.com', '019a0000-0000-7000-8000-000000000001');
INSERT INTO "Document" (id, name, owner, "fileType")
VALUES ('drop-doc', 'drop.pdf', 'macro|drop@example.com', 'pdf');
INSERT INTO comms_channels (id, channel_type, owner_id)
VALUES ('019a0000-0000-7000-8000-000000000002', 'private', 'macro|drop@example.com');
INSERT INTO "Thread" (id, owner, "documentId") VALUES (1, 'macro|drop@example.com', 'drop-doc');
INSERT INTO "Comment" (id, "threadId", owner, text) VALUES (2, 1, 'macro|drop@example.com', 'imported');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
VALUES ('019a0000-0000-7000-8000-000000000003', 'document', 'drop-doc', 'macro|drop@example.com', 'imported'),
       ('019a0000-0000-7000-8000-000000000004', 'channel', '019a0000-0000-7000-8000-000000000002', 'macro|drop@example.com', 'channel');
INSERT INTO migrated_comment_id VALUES (2, '019a0000-0000-7000-8000-000000000003', 'drop-doc');
INSERT INTO migrated_comment_thread_id VALUES (1, '019a0000-0000-7000-8000-000000000003', 'drop-doc');
INSERT INTO comms_attachments (id, message_id, entity_type, entity_id, channel_id)
VALUES ('019a0000-0000-7000-8000-000000000005', '019a0000-0000-7000-8000-000000000004', 'document', 'drop-doc', '019a0000-0000-7000-8000-000000000002');
INSERT INTO "PdfPlaceableCommentAnchor" (
    uuid, "documentId", owner, page, "wasEdited", "wasDeleted", "shouldLockOnSave",
    "originalPage", "originalIndex", "xPct", "yPct", "widthPct", "heightPct", rotation, "threadId", root_id
) VALUES ('019a0000-0000-7000-8000-000000000006', 'drop-doc', 'macro|drop@example.com', 1, false, false, false,
          1, 0, 0.1, 0.2, 0.3, 0.4, 0, 1, '019a0000-0000-7000-8000-000000000003');
INSERT INTO "PdfHighlightAnchor" (
    uuid, "documentId", owner, page, red, green, blue, alpha, type, text,
    "pageViewportWidth", "pageViewportHeight", "threadId", root_id
) VALUES ('019a0000-0000-7000-8000-000000000007', 'drop-doc', 'macro|drop@example.com', 1, 255, 255, 0, 0.5, 1, 'text',
          600, 800, 1, '019a0000-0000-7000-8000-000000000003');
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
VALUES ('019a0000-0000-7000-8000-000000000008', 'commented_on_document', 'drop-doc', 'document', 'test',
        '{"commentId":"019a0000-0000-7000-8000-000000000003"}');
INSERT INTO team (id, name, owner_id)
VALUES ('019a0000-0000-7000-8000-000000000009', 'drop team', 'macro|drop@example.com');
INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction)
VALUES ('019a0000-0000-7000-8000-000000000010', '019a0000-0000-7000-8000-000000000009', now(), now());
INSERT INTO crm_thread (id, company_id, owner)
VALUES ('019a0000-0000-7000-8000-000000000011', '019a0000-0000-7000-8000-000000000010', 'macro|drop@example.com');
INSERT INTO crm_comment (id, thread_id, owner, text)
VALUES ('019a0000-0000-7000-8000-000000000012', '019a0000-0000-7000-8000-000000000011', 'macro|drop@example.com', 'CRM imported');
INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
VALUES ('019a0000-0000-7000-8000-000000000012', 'crm_company', '019a0000-0000-7000-8000-000000000010', 'macro|drop@example.com', 'CRM imported');
