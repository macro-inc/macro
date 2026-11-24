-- Database row search: who can see which database, and what its rows say.
--
-- "Accounts" (database 1) is live. Its owner owns it; a viewer holds a direct
-- grant, a team member reaches it through the team's grant, a channel member
-- through a channel's grant, a folder viewer through the grant of the folder it
-- is filed in, and a form responder through a live form that shares its
-- responses. A stranger has nothing. "Archive" (database 2) is in the Trash,
-- and database 3 is CRM storage with no database entity.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-7000-8000-000000000001', 'owner', 'owner@example.com', 'cus_owner'),
    ('00000000-0000-7000-8000-000000000002', 'viewer', 'viewer@example.com', 'cus_viewer'),
    ('00000000-0000-7000-8000-000000000003', 'teammate', 'teammate@example.com', 'cus_teammate'),
    ('00000000-0000-7000-8000-000000000004', 'channel', 'channel@example.com', 'cus_channel'),
    ('00000000-0000-7000-8000-000000000005', 'folder', 'folder@example.com', 'cus_folder'),
    ('00000000-0000-7000-8000-000000000006', 'responder', 'responder@example.com', 'cus_responder'),
    ('00000000-0000-7000-8000-000000000007', 'stranger', 'stranger@example.com', 'cus_stranger');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|owner@example.com', 'owner@example.com', '00000000-0000-7000-8000-000000000001'),
    ('macro|viewer@example.com', 'viewer@example.com', '00000000-0000-7000-8000-000000000002'),
    ('macro|teammate@example.com', 'teammate@example.com', '00000000-0000-7000-8000-000000000003'),
    ('macro|channel@example.com', 'channel@example.com', '00000000-0000-7000-8000-000000000004'),
    ('macro|folder@example.com', 'folder@example.com', '00000000-0000-7000-8000-000000000005'),
    ('macro|responder@example.com', 'responder@example.com', '00000000-0000-7000-8000-000000000006'),
    ('macro|stranger@example.com', 'stranger@example.com', '00000000-0000-7000-8000-000000000007');

INSERT INTO team (id, name, owner_id) VALUES
    ('0e000000-0000-7000-8000-000000000001', 'Sales', 'macro|owner@example.com');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|teammate@example.com', '0e000000-0000-7000-8000-000000000001', 'member');

INSERT INTO comms_channels (id, channel_type, owner_id) VALUES
    ('0c000000-0000-7000-8000-000000000001', 'private', 'macro|owner@example.com');
INSERT INTO comms_channel_participants (channel_id, role, user_id) VALUES
    ('0c000000-0000-7000-8000-000000000001', 'owner', 'macro|owner@example.com'),
    ('0c000000-0000-7000-8000-000000000001', 'member', 'macro|channel@example.com');

INSERT INTO "Project" (id, name, "userId") VALUES
    ('0f000000-0000-7000-8000-000000000001', 'Clients', 'macro|owner@example.com');

INSERT INTO databases (id) VALUES
    ('10000000-0000-7000-8000-000000000001'),
    ('10000000-0000-7000-8000-000000000002'),
    ('10000000-0000-7000-8000-000000000003');
INSERT INTO database_entities (database_id, name, user_id, trashed_at) VALUES
    ('10000000-0000-7000-8000-000000000001', 'Accounts', 'macro|owner@example.com', NULL),
    ('10000000-0000-7000-8000-000000000002', 'Archive', 'macro|owner@example.com', now());

INSERT INTO database_tables (id, database_id, name, position) VALUES
    ('20000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'Customers', 'a'),
    ('20000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000002', 'Customers', 'a'),
    ('20000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000003', 'Deals', 'a');

INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select, specific_entity_type) VALUES
    ('30000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'Name', 'STRING', false, NULL),
    ('30000000-0000-7000-8000-000000000002', '10000000-0000-7000-8000-000000000001', 'Notes', 'STRING', false, NULL),
    ('30000000-0000-7000-8000-000000000003', '10000000-0000-7000-8000-000000000001', 'Related', 'ENTITY', true, 'DATABASE_ROW'),
    ('30000000-0000-7000-8000-000000000004', '10000000-0000-7000-8000-000000000002', 'Name', 'STRING', false, NULL),
    ('30000000-0000-7000-8000-000000000005', '10000000-0000-7000-8000-000000000003', 'Name', 'STRING', false, NULL);

INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES
    ('50000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', 'a'),
    ('50000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000002', 'b'),
    ('50000000-0000-7000-8000-000000000003', '20000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000003', 'c'),
    ('50000000-0000-7000-8000-000000000004', '20000000-0000-7000-8000-000000000002', '30000000-0000-7000-8000-000000000004', 'a'),
    ('50000000-0000-7000-8000-000000000005', '20000000-0000-7000-8000-000000000003', '30000000-0000-7000-8000-000000000005', 'a');

-- Row 1 says Acme. Row 2 says Globex but links row 1, whose title is Acme.
-- Row 3 is in the trashed database, row 4 in CRM storage.
INSERT INTO database_rows (id, table_id, position, updated_at) VALUES
    ('60000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 'a', '2026-11-20T10:00:00Z'),
    ('60000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', 'b', '2026-11-19T10:00:00Z'),
    ('60000000-0000-7000-8000-000000000003', '20000000-0000-7000-8000-000000000002', 'a', '2026-11-18T10:00:00Z'),
    ('60000000-0000-7000-8000-000000000004', '20000000-0000-7000-8000-000000000003', 'a', '2026-11-17T10:00:00Z');

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
    ('70000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000001',
     '{"type": "String", "value": "Acme Corp"}'),
    ('70000000-0000-7000-8000-000000000002', '60000000-0000-7000-8000-000000000001', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000002',
     '{"type": "String", "value": "Renewal with Acme due in May"}'),
    ('70000000-0000-7000-8000-000000000003', '60000000-0000-7000-8000-000000000002', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000001',
     '{"type": "String", "value": "Globex"}'),
    ('70000000-0000-7000-8000-000000000004', '60000000-0000-7000-8000-000000000002', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000003',
     '{"type": "EntityReference", "value": [{"entity_type": "DATABASE_ROW", "entity_id": "60000000-0000-7000-8000-000000000001"}]}'),
    ('70000000-0000-7000-8000-000000000005', '60000000-0000-7000-8000-000000000003', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000004',
     '{"type": "String", "value": "Acme archived"}'),
    ('70000000-0000-7000-8000-000000000006', '60000000-0000-7000-8000-000000000004', 'DATABASE_ROW', '30000000-0000-7000-8000-000000000005',
     '{"type": "String", "value": "Acme pipeline deal"}');

INSERT INTO forms (id, name, owner_id, database_id, table_id, responses_visible) VALUES
    ('80000000-0000-7000-8000-000000000001', 'Intake', 'macro|owner@example.com',
     '10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', true);

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
    ('10000000-0000-7000-8000-000000000001', 'database', 'macro|owner@example.com', 'user', 'owner', NULL),
    ('10000000-0000-7000-8000-000000000001', 'database', 'macro|viewer@example.com', 'user', 'view', NULL),
    ('10000000-0000-7000-8000-000000000001', 'database', '0e000000-0000-7000-8000-000000000001', 'team', 'view', NULL),
    ('10000000-0000-7000-8000-000000000001', 'database', '0c000000-0000-7000-8000-000000000001', 'channel', 'view', NULL),
    ('10000000-0000-7000-8000-000000000001', 'database', 'macro|folder@example.com', 'user', 'view', '0f000000-0000-7000-8000-000000000001'),
    ('80000000-0000-7000-8000-000000000001', 'form', 'macro|responder@example.com', 'user', 'view', NULL),
    ('10000000-0000-7000-8000-000000000002', 'database', 'macro|owner@example.com', 'user', 'owner', NULL),
    ('10000000-0000-7000-8000-000000000002', 'database', 'macro|viewer@example.com', 'user', 'view', NULL),
    ('10000000-0000-7000-8000-000000000003', 'database', 'macro|viewer@example.com', 'user', 'view', NULL);
