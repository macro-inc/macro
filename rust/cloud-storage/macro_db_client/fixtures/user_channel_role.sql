-- Organization (needed for org channel)
INSERT INTO public."Organization" ("id", "name")
VALUES (1, 'Test Org');

-- Users: user-1 belongs to org 1, user-2 has no org
INSERT INTO public."User" ("id", "email", "organizationId")
VALUES ('user-1', 'user1@test.com', 1),
       ('user-2', 'user2@test.com', NULL);

-- Channels
-- Public channel (no org)
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Public Channel', 'public', NULL, 'user-1');

-- Organization channel (org_id = 1)
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('a0000000-0000-0000-0000-000000000002', 'Org Channel', 'organization', 1, 'user-1');

-- Private channel
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('a0000000-0000-0000-0000-000000000003', 'Private Channel', 'private', NULL, 'user-1');

-- DM channel (name must be NULL per constraint)
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('a0000000-0000-0000-0000-000000000004', NULL, 'direct_message', NULL, 'user-1');

-- Participants
-- user-2 is member in public channel
INSERT INTO comms_channel_participants (channel_id, user_id, role)
VALUES ('a0000000-0000-0000-0000-000000000001', 'user-2', 'member');

-- user-1 is admin in org channel
INSERT INTO comms_channel_participants (channel_id, user_id, role)
VALUES ('a0000000-0000-0000-0000-000000000002', 'user-1', 'admin');

-- user-1 is owner in private channel
INSERT INTO comms_channel_participants (channel_id, user_id, role)
VALUES ('a0000000-0000-0000-0000-000000000003', 'user-1', 'owner');

-- user-2 is member in DM channel
INSERT INTO comms_channel_participants (channel_id, user_id, role)
VALUES ('a0000000-0000-0000-0000-000000000004', 'user-2', 'member');
