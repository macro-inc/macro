INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-0000-0000-000000000001', 'owner@requests.test', 'owner@requests.test', 'owner'),
('00000000-0000-0000-0000-000000000002', 'reader@requests.test', 'reader@requests.test', 'reader'),
('00000000-0000-0000-0000-000000000003', 'outsider@requests.test', 'outsider@requests.test', 'outsider');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@requests.test', 'owner@requests.test', '00000000-0000-0000-0000-000000000001'),
('macro|reader@requests.test', 'reader@requests.test', '00000000-0000-0000-0000-000000000002'),
('macro|outsider@requests.test', 'outsider@requests.test', '00000000-0000-0000-0000-000000000003');
INSERT INTO "Document" (id, name, owner, "fileType") VALUES
('00000000-0000-0000-0000-000000000010', 'Shared document', 'macro|owner@requests.test', 'md');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
('00000000-0000-0000-0000-000000000010', 'document', 'macro|owner@requests.test', 'user', 'owner'),
('00000000-0000-0000-0000-000000000010', 'document', 'macro|reader@requests.test', 'user', 'view');
