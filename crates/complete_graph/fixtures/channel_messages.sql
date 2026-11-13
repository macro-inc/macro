-- Fixture for the channel message write tests.
--
-- Channels: ...a1 (author owns it, member joined) and ...b1 (author only).
-- outsider belongs to neither.
INSERT INTO comms_channels (id, name, owner_id, channel_type) VALUES
('00000000-0000-0000-0000-0000000000a1', 'writes', 'macro|user@example.com', 'private'),
('00000000-0000-0000-0000-0000000000b1', 'elsewhere', 'macro|user@example.com', 'private');
INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES
('00000000-0000-0000-0000-0000000000a1', 'macro|user@example.com', 'owner'),
('00000000-0000-0000-0000-0000000000a1', 'macro|member@example.com', 'member'),
('00000000-0000-0000-0000-0000000000b1', 'macro|user@example.com', 'owner');
