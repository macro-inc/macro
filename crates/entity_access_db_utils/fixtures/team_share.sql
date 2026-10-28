INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('50000000-0000-0000-0000-000000000001', 'owner@example.com', 'owner@example.com', 'cus_owner');
INSERT INTO "User" (id, email, name, macro_user_id) VALUES
    ('macro|owner@example.com', 'owner@example.com', 'Owner', '50000000-0000-0000-0000-000000000001');
INSERT INTO "Project" (id, name, "userId") VALUES
    ('20000000-0000-0000-0000-000000000001', 'Root', 'macro|owner@example.com');
INSERT INTO "Project" (id, name, "userId", "parentId") VALUES
    ('20000000-0000-0000-0000-000000000003', 'Child', 'macro|owner@example.com', '20000000-0000-0000-0000-000000000001');
INSERT INTO "Document" (id, name, owner, "projectId") VALUES
    ('20000000-0000-0000-0000-000000000002', 'Document', 'macro|owner@example.com', '20000000-0000-0000-0000-000000000003');
INSERT INTO "Chat" (id, name, "userId", "projectId") VALUES
    ('20000000-0000-0000-0000-000000000004', 'Chat', 'macro|owner@example.com', '20000000-0000-0000-0000-000000000003');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
    ('30000000-0000-0000-0000-000000000001', 'macro|owner@example.com', 'fusionauth', 'alias@example.com', 'GMAIL');
INSERT INTO email_threads (id, link_id, project_id) VALUES
    ('20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
    ('20000000-0000-0000-0000-000000000002', 'document', '10000000-0000-0000-0000-000000000001', 'team', 'edit', NULL),
    ('20000000-0000-0000-0000-000000000002', 'document', '10000000-0000-0000-0000-000000000001', 'team', 'comment', '20000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', 'document', 'other-team', 'team', 'view', NULL);
