INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('50000000-0000-0000-0000-000000000001', 'owner@example.com', 'owner@example.com', 'cus_owner');
INSERT INTO "User" (id, email, name, macro_user_id) VALUES
    ('macro|owner@example.com', 'owner@example.com', 'Owner', '50000000-0000-0000-0000-000000000001');
INSERT INTO "Document" (id, name, owner, "fileType") VALUES
    ('20000000-0000-0000-0000-000000000001', 'Contract', 'macro|owner@example.com', 'pdf'),
    ('20000000-0000-0000-0000-000000000002', 'Notes', 'macro|owner@example.com', 'md');
INSERT INTO "SharePermission" (id) VALUES ('pdf'), ('md');
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES
    ('20000000-0000-0000-0000-000000000001', 'pdf'),
    ('20000000-0000-0000-0000-000000000002', 'md');
