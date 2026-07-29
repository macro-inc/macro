INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Macro', 'private', 'macro|member@test.com', '2024-01-01 10:00:00+00', '2024-12-01 10:00:00+00'),
    ('22222222-2222-2222-2222-222222222222', 'Macro Planning', 'private', 'macro|member@test.com', '2024-01-02 10:00:00+00', '2024-12-02 10:00:00+00'),
    ('33333333-3333-3333-3333-333333333333', 'Macaroni', 'private', 'macro|member@test.com', '2024-01-03 10:00:00+00', '2024-12-03 10:00:00+00'),
    ('44444444-4444-4444-4444-444444444444', 'Macro Secret', 'private', 'macro|other@test.com', '2024-01-04 10:00:00+00', '2024-12-04 10:00:00+00'),
    ('55555555-5555-5555-5555-555555555555', 'Macro Former', 'private', 'macro|former@test.com', '2024-01-05 10:00:00+00', '2024-12-05 10:00:00+00'),
    ('66666666-6666-6666-6666-666666666666', NULL, 'direct_message', 'macro|member@test.com', '2024-01-06 10:00:00+00', '2024-12-06 10:00:00+00');

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'owner', 'macro|member@test.com', NULL),
    ('22222222-2222-2222-2222-222222222222', 'owner', 'macro|member@test.com', NULL),
    ('33333333-3333-3333-3333-333333333333', 'owner', 'macro|member@test.com', NULL),
    ('44444444-4444-4444-4444-444444444444', 'owner', 'macro|other@test.com', NULL),
    ('55555555-5555-5555-5555-555555555555', 'owner', 'macro|former@test.com', '2024-06-01 10:00:00+00'),
    ('66666666-6666-6666-6666-666666666666', 'owner', 'macro|member@test.com', NULL),
    ('66666666-6666-6666-6666-666666666666', 'member', 'macro|gabriel@test.com', NULL);
