INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('93000000-0000-0000-0000-000000000001', 'docx-owner', 'docx-owner@example.com', 'cus_docx_owner');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|docx-owner@example.com', 'docx-owner@example.com', '93000000-0000-0000-0000-000000000001');
INSERT INTO "Document" (id, name, owner, "fileType", "deletedAt") VALUES
    ('93000000-0000-0000-0000-000000000011', 'Trashed docx', 'macro|docx-owner@example.com', 'docx', '2026-01-01 00:00:00');
INSERT INTO "DocumentBom" (id, "documentId") VALUES
    (930001, '93000000-0000-0000-0000-000000000011');
INSERT INTO "BomPart" ("documentBomId", sha, path) VALUES
    (930001, 'sha-a', 'word/document.xml'),
    (930001, 'sha-b', 'word/styles.xml'),
    (930001, 'sha-a', 'word/media/copy.xml');
