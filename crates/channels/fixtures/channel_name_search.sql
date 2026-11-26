-- One viewer's channels, covering every way a channel gets its viewer-facing
-- name: stored names, DMs and unnamed private channels named after people with
-- and without profiles, owned, deleted, unknown and first-party bots.
INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES
    ('c0000000-0000-0000-0000-000000000000', 'viewer', 'viewer@example.com', 'cus_viewer'),
    ('c0000000-0000-0000-0000-000000000001', 'ada', 'ada@example.com', 'cus_ada'),
    ('c0000000-0000-0000-0000-000000000002', 'adam', 'adam@example.com', 'cus_adam'),
    ('c0000000-0000-0000-0000-000000000003', 'grace', 'grace@example.com', 'cus_grace'),
    ('c0000000-0000-0000-0000-000000000004', 'blank.profile', 'blank.profile@example.com', 'cus_blank_profile'),
    ('c0000000-0000-0000-0000-000000000005', 'noinfo', 'noinfo@example.com', 'cus_noinfo'),
    ('c0000000-0000-0000-0000-000000000006', 'former', 'former@example.com', 'cus_former');

INSERT INTO "User" (id, email, macro_user_id)
VALUES
    ('macro|viewer@example.com', 'viewer@example.com', 'c0000000-0000-0000-0000-000000000000'),
    ('macro|ada@example.com', 'ada@example.com', 'c0000000-0000-0000-0000-000000000001'),
    ('macro|adam@example.com', 'adam@example.com', 'c0000000-0000-0000-0000-000000000002'),
    ('macro|grace@example.com', 'grace@example.com', 'c0000000-0000-0000-0000-000000000003'),
    ('macro|blank.profile@example.com', 'blank.profile@example.com', 'c0000000-0000-0000-0000-000000000004'),
    ('macro|noinfo@example.com', 'noinfo@example.com', 'c0000000-0000-0000-0000-000000000005'),
    ('macro|former@example.com', 'former@example.com', 'c0000000-0000-0000-0000-000000000006');

-- noinfo has no profile row and ghost@example.com has no user row: both are
-- known by the local part of their email.
INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
VALUES
    ('c0000000-0000-0000-0000-000000000000', 'Vera', 'Viewer'),
    ('c0000000-0000-0000-0000-000000000001', 'Ada', 'Lovelace'),
    ('c0000000-0000-0000-0000-000000000002', 'Adam', 'N/A'),
    ('c0000000-0000-0000-0000-000000000003', 'Grace', 'Hopper'),
    ('c0000000-0000-0000-0000-000000000004', 'N/A', 'N/A'),
    ('c0000000-0000-0000-0000-000000000006', 'Fern', 'Former');

INSERT INTO bots (id, kind, owner_user_id, name, handle, created_by, deleted_at)
VALUES
    ('b1000000-0000-0000-0000-000000000001', 'owned', 'macro|viewer@example.com', 'Helper Owl', 'helper-owl', 'macro|viewer@example.com', NULL),
    ('b1000000-0000-0000-0000-000000000002', 'owned', 'macro|viewer@example.com', 'Retired Robin', 'retired-robin', 'macro|viewer@example.com', '2024-06-01 10:00:00+00');

INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at)
VALUES
    ('c1000000-0000-0000-0000-000000000001', 'Roadmap Planning', 'public', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-01 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000002', 'Ada Fans', 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-02 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000003', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-03 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000004', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-04 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000005', NULL, 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-05 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000006', '   ', 'private', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-06 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000007', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-07 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000008', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-08 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000009', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-09 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000a', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-10 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000b', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-11 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000c', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-12 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000d', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-12 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000e', NULL, 'direct_message', 'macro|viewer@example.com', '2024-01-01 10:00:00+00', '2024-12-14 10:00:00+00'),
    ('c1000000-0000-0000-0000-00000000000f', 'Ada Archive', 'private', 'macro|ada@example.com', '2024-01-01 10:00:00+00', '2024-12-15 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000010', NULL, 'direct_message', 'macro|ada@example.com', '2024-01-01 10:00:00+00', '2024-12-16 10:00:00+00');

INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
VALUES
    -- Roadmap Planning and Ada Fans: known by their stored names only.
    ('c1000000-0000-0000-0000-000000000001', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000001', 'member', 'macro|grace@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000002', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000002', 'member', 'macro|grace@example.com', NULL),
    -- DM with Ada Lovelace; DM with Adam (last name N/A).
    ('c1000000-0000-0000-0000-000000000003', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000003', 'member', 'macro|ada@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000004', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000004', 'member', 'macro|adam@example.com', NULL),
    -- Unnamed group: Ada, Grace and the owned bot; Fern left it.
    ('c1000000-0000-0000-0000-000000000005', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000005', 'member', 'macro|ada@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000005', 'member', 'macro|grace@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000005', 'member', 'bot|b1000000-0000-0000-0000-000000000001', NULL),
    ('c1000000-0000-0000-0000-000000000005', 'member', 'macro|former@example.com', '2024-06-01 10:00:00+00'),
    -- Blank-named private channel: named after Grace and the system coder bot.
    ('c1000000-0000-0000-0000-000000000006', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000006', 'member', 'macro|grace@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000006', 'member', 'bot|00000000-0000-0000-0000-00000000a9e7', NULL),
    -- DMs with a profile of only N/A, a user without a profile, a person
    -- without a user row, a deleted bot, an unknown bot and a system bot.
    ('c1000000-0000-0000-0000-000000000007', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000007', 'member', 'macro|blank.profile@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000008', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000008', 'member', 'macro|noinfo@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000009', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000009', 'member', 'macro|ghost@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000a', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000a', 'member', 'bot|b1000000-0000-0000-0000-000000000002', NULL),
    ('c1000000-0000-0000-0000-00000000000b', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000b', 'member', 'bot|b1000000-0000-0000-0000-0000000000ff', NULL),
    -- Two DMs with Grace updated at the same moment: the id breaks the tie.
    ('c1000000-0000-0000-0000-00000000000c', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000c', 'member', 'macro|grace@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000d', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000d', 'member', 'bot|00000000-0000-0000-0000-00000000c5c5', NULL),
    -- A DM Fern left: no one but the viewer to name it after.
    ('c1000000-0000-0000-0000-00000000000e', 'owner', 'macro|viewer@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000e', 'member', 'macro|former@example.com', '2024-06-01 10:00:00+00'),
    -- Channels the viewer left or never joined.
    ('c1000000-0000-0000-0000-00000000000f', 'owner', 'macro|ada@example.com', NULL),
    ('c1000000-0000-0000-0000-00000000000f', 'member', 'macro|viewer@example.com', '2024-06-01 10:00:00+00'),
    ('c1000000-0000-0000-0000-000000000010', 'owner', 'macro|ada@example.com', NULL),
    ('c1000000-0000-0000-0000-000000000010', 'member', 'macro|grace@example.com', NULL);
