-- A viewer and a colleague, each with an inbox, a personal tag set, and
-- channels the viewer is and isn't in, for the names typed into operators.
INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES
    ('d0000000-0000-0000-0000-000000000000', 'viewer', 'viewer@example.com', 'cus_viewer'),
    ('d0000000-0000-0000-0000-000000000001', 'ana', 'ana@example.com', 'cus_ana');

INSERT INTO "User" (id, email, macro_user_id)
VALUES
    ('macro|viewer@example.com', 'viewer@example.com', 'd0000000-0000-0000-0000-000000000000'),
    ('macro|ana@example.com', 'ana@example.com', 'd0000000-0000-0000-0000-000000000001');

INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
VALUES
    ('d0000000-0000-0000-0000-000000000000', 'Vera', 'Viewer'),
    ('d0000000-0000-0000-0000-000000000001', 'Ana', 'Lima');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
VALUES
    ('d1000000-0000-0000-0000-000000000001', 'macro|viewer@example.com', 'macro|viewer@example.com', 'Viewer@Example.com', 'GMAIL'),
    ('d1000000-0000-0000-0000-000000000002', 'macro|ana@example.com', 'macro|ana@example.com', 'ana@example.com', 'GMAIL');

INSERT INTO property_definitions (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type)
VALUES
    ('d2000000-0000-0000-0000-000000000001', NULL, 'macro|viewer@example.com', 'Tags', 'TAG', true, NULL),
    ('d2000000-0000-0000-0000-000000000002', NULL, 'macro|ana@example.com', 'Tags', 'TAG', true, NULL);

INSERT INTO property_options (id, property_definition_id, display_order, number_value, string_value, color)
VALUES
    ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 0, NULL, 'Finance', NULL),
    ('d3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 1, NULL, 'Finance review', NULL),
    ('d3000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000002', 0, NULL, 'finance', NULL);

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
VALUES
    ('d4000000-0000-0000-0000-000000000001', 'Launch', 'public', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-01 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000002', 'Launch plan', 'public', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-02 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000003', 'launch', 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-03 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000004', 'Launch', 'public', 'macro|ana@example.com', '2024-01-01 10:00:00+00', '2024-12-04 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000005', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-05 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000006', 'Launch', 'public', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-06 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000007', NULL, 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-07 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000008', NULL, 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-08 10:00:00+00'),
    ('d4000000-0000-0000-0000-000000000009', 'Launch "beta"', 'public', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-09 10:00:00+00');

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
VALUES
    ('d4000000-0000-0000-0000-000000000001', 'owner', 'macro|viewer@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000002', 'owner', 'macro|viewer@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000003', 'owner', 'macro|viewer@example.com', NULL),
    -- Ana's Launch, which the viewer is not in.
    ('d4000000-0000-0000-0000-000000000004', 'owner', 'macro|ana@example.com', NULL),
    -- The viewer's DM with Ana Lima, named after her.
    ('d4000000-0000-0000-0000-000000000005', 'owner', 'macro|viewer@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000005', 'member', 'macro|ana@example.com', NULL),
    -- A Launch the viewer has left.
    ('d4000000-0000-0000-0000-000000000006', 'owner', 'macro|viewer@example.com', '2024-06-01 10:00:00+00'),
    -- An unnamed group with Ana Lima and someone else, named after both.
    ('d4000000-0000-0000-0000-000000000007', 'owner', 'macro|viewer@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000007', 'member', 'macro|ana@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000007', 'member', 'macro|ben@example.com', NULL),
    -- An unnamed group with Ana Lima alone, named after her.
    ('d4000000-0000-0000-0000-000000000008', 'owner', 'macro|viewer@example.com', NULL),
    ('d4000000-0000-0000-0000-000000000008', 'member', 'macro|ana@example.com', NULL),
    -- A channel whose name holds double quotes.
    ('d4000000-0000-0000-0000-000000000009', 'owner', 'macro|viewer@example.com', NULL);
