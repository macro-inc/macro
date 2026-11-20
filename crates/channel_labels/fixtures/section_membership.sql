INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('70000000-0000-0000-0000-000000000001', 'alice@example.com', 'alice@example.com', 'cus_alice'),
    ('70000000-0000-0000-0000-000000000002', 'bob@example.com', 'bob@example.com', 'cus_bob'),
    ('70000000-0000-0000-0000-000000000003', 'carol@example.com', 'carol@example.com', 'cus_carol'),
    ('70000000-0000-0000-0000-000000000004', 'dave@example.com', 'dave@example.com', 'cus_dave');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|alice@example.com', 'alice@example.com', '70000000-0000-0000-0000-000000000001'),
    ('macro|bob@example.com', 'bob@example.com', '70000000-0000-0000-0000-000000000002'),
    ('macro|carol@example.com', 'carol@example.com', '70000000-0000-0000-0000-000000000003'),
    ('macro|dave@example.com', 'dave@example.com', '70000000-0000-0000-0000-000000000004');
INSERT INTO team (id, name, owner_id) VALUES
    ('71000000-0000-0000-0000-000000000001', 'Acme', 'macro|alice@example.com');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
    ('macro|alice@example.com', '71000000-0000-0000-0000-000000000001', 'owner'),
    ('macro|carol@example.com', '71000000-0000-0000-0000-000000000001', 'member');
INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id) VALUES
    ('72000000-0000-0000-0000-000000000001', 'Eng-API', 'team', 'macro|alice@example.com',
     '71000000-0000-0000-0000-000000000001'),
    ('72000000-0000-0000-0000-000000000002', NULL, 'direct_message', 'macro|alice@example.com', NULL);
-- Dave left the channel: his personal sections no longer hold it.
INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at, left_at) VALUES
    ('72000000-0000-0000-0000-000000000001', 'macro|alice@example.com', 'owner', NOW(), NULL),
    ('72000000-0000-0000-0000-000000000001', 'macro|bob@example.com', 'member', NOW(), NULL),
    ('72000000-0000-0000-0000-000000000001', 'macro|carol@example.com', 'member', NOW(), NULL),
    ('72000000-0000-0000-0000-000000000001', 'macro|dave@example.com', 'member', NOW(), NOW());
-- Team sections: a manual one holding the channel, a rule matching its name,
-- and a manual one that doesn't hold it.
INSERT INTO channel_label (id, team_id, name, name_contains, sort_order) VALUES
    ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'Platform', NULL, 0),
    ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 'Engineering', 'eng', 1),
    ('73000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'Sales', NULL, 2);
-- Bob's personal sections: a manual one and a rule.
INSERT INTO channel_label (id, user_id, name, name_contains, sort_order) VALUES
    ('73000000-0000-0000-0000-000000000004', 'macro|bob@example.com', 'Mine', NULL, 0),
    ('73000000-0000-0000-0000-000000000005', 'macro|bob@example.com', 'APIs', 'api', 1),
    ('73000000-0000-0000-0000-000000000006', 'macro|bob@example.com', 'Design', 'design', 2);
INSERT INTO channel_label_channel (scope_key, channel_id, label_id) VALUES
    ('team:71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001',
     '73000000-0000-0000-0000-000000000001'),
    ('user:macro|bob@example.com', '72000000-0000-0000-0000-000000000001',
     '73000000-0000-0000-0000-000000000004');
INSERT INTO favorite (user_id, entity_type, entity_id) VALUES
    ('macro|carol@example.com', 'channel', '72000000-0000-0000-0000-000000000001'),
    ('macro|dave@example.com', 'channel', '72000000-0000-0000-0000-000000000002');
INSERT INTO channel_label (id, user_id, name, name_contains, sort_order) VALUES
    ('73000000-0000-0000-0000-000000000007', 'macro|dave@example.com', 'Old', 'eng', 0);
