-- Twenty-five unnamed groups with Ana Lima and someone else, all newer than
-- the viewer's private channel named "Ana Lima".
INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
SELECT ('d5000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, NULL, 'private',
       'macro|viewer@example.com', '2025-01-01 10:00:00+00', '2025-01-01 10:00:00+00'::timestamptz + g * interval '1 minute'
FROM generate_series(1, 25) g;

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
SELECT ('d5000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, member.role::comms_participant_role, member.user_id, NULL
FROM generate_series(1, 25) g
CROSS JOIN LATERAL (
    VALUES ('owner', 'macro|viewer@example.com'),
           ('member', 'macro|ana@example.com'),
           ('member', 'macro|other' || g || '@example.com')
) AS member(role, user_id);

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
VALUES ('d5000000-0000-0000-0000-0000000000ff', 'Ana Lima', 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-02-01 10:00:00+00');

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
VALUES ('d5000000-0000-0000-0000-0000000000ff', 'owner', 'macro|viewer@example.com', NULL);
