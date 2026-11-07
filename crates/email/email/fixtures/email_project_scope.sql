-- Fixture for project-scoped dynamic query tests. Builds on
-- email_dynamic_query + email_shared_threads (user1/link aaaa, user2/link bbbb,
-- shared project cccccccc with a 'view' grant for user1, thread 102 in it).
--
-- Adds:
--   * user1's own threads filed into projects (301 in shared cccccccc,
--     302 in user2's private project)
--   * a team-granted project (dddd0000) with a user2 thread (105)
--   * a private user2 project (eeee0000) with a user2 thread (106)
--   * a non-inbox user2 thread in the shared project (107)

-- == Team: user1 is a member, project dddd0000 is granted to the team ==
INSERT INTO team (id, name, owner_id)
VALUES ('77770000-0000-0000-0000-000000007777', 'Scope Team', 'macro|user2@test.com');

INSERT INTO team_user (user_id, team_id, team_role)
VALUES
    ('macro|user2@test.com', '77770000-0000-0000-0000-000000007777', 'owner'),
    ('macro|user1@test.com', '77770000-0000-0000-0000-000000007777', 'member');

-- == Projects owned by user2 ==
INSERT INTO "Project" (id, name, "userId", "createdAt", "updatedAt")
VALUES
    ('dddd0000-0000-0000-0000-00000000dddd', 'Team Project', 'macro|user2@test.com', NOW(), NOW()),
    ('eeee0000-0000-0000-0000-00000000eeee', 'Private Project', 'macro|user2@test.com', NOW(), NOW());

-- Team grant on the team project. No grants at all on the private project.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES ('dddd0000-0000-0000-0000-00000000dddd'::uuid, 'project', '77770000-0000-0000-0000-000000007777', 'team', 'view');

-- == user1's own threads filed into projects ==
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at, project_id
)
VALUES
    -- Thread 301: user1's own thread in the shared project cccccccc
    ('20000301-0000-0000-0000-000000000301', 'own_in_shared_project', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-03-01 10:00:00+00', NULL, '2024-03-01 10:00:00+00', NOW(), NOW(),
     'cccccccc-cccc-cccc-cccc-cccccccccccc'),

    -- Thread 302: user1's own thread filed into user2's PRIVATE project
    -- (owned-branch visibility must not depend on project access)
    ('20000302-0000-0000-0000-000000000302', 'own_in_private_project', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     true, false, '2024-03-02 10:00:00+00', NULL, '2024-03-02 10:00:00+00', NOW(), NOW(),
     'eeee0000-0000-0000-0000-00000000eeee');

-- == user2's threads ==
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at, project_id
)
VALUES
    -- Thread 105: in the team-granted project
    ('20000105-0000-0000-0000-000000000105', 'team_project_thread', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     true, false, '2024-03-05 10:00:00+00', NULL, '2024-03-05 10:00:00+00', NOW(), NOW(),
     'dddd0000-0000-0000-0000-00000000dddd'),

    -- Thread 106: in user2's private project (user1 must never see it)
    ('20000106-0000-0000-0000-000000000106', 'private_project_thread', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     true, false, '2024-03-06 10:00:00+00', NULL, '2024-03-06 10:00:00+00', NOW(), NOW(),
     'eeee0000-0000-0000-0000-00000000eeee'),

    -- Thread 107: in the shared project but NOT inbox-visible (archived,
    -- outbound-only) — view filters must still apply to widened threads
    ('20000107-0000-0000-0000-000000000107', 'archived_project_thread', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     false, false, NULL, '2024-03-07 10:00:00+00', '2024-03-07 10:00:00+00', NOW(), NOW(),
     'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- == Messages (the query's lateral requires one per thread) ==
INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('30000301-0000-0000-0000-000000000301', '20000301-0000-0000-0000-000000000301',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'own_shared_msg', '40000001-0000-0000-0000-000000000001',
     'Own In Shared Project', 'My thread in the shared project', '2024-03-01 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    ('30000302-0000-0000-0000-000000000302', '20000302-0000-0000-0000-000000000302',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'own_private_msg', '40000001-0000-0000-0000-000000000001',
     'Own In Private Project', 'My thread in a project I lost access to', '2024-03-02 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    ('30000105-0000-0000-0000-000000000105', '20000105-0000-0000-0000-000000000105',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'team_project_msg', '40000005-0000-0000-0000-000000000005',
     'Team Project Thread', 'Visible through the team grant', '2024-03-05 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    ('30000106-0000-0000-0000-000000000106', '20000106-0000-0000-0000-000000000106',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'private_project_msg', '40000005-0000-0000-0000-000000000005',
     'Private Project Thread', 'Should stay hidden from user1', '2024-03-06 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    ('30000107-0000-0000-0000-000000000107', '20000107-0000-0000-0000-000000000107',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'archived_project_msg', '40000005-0000-0000-0000-000000000005',
     'Archived Project Thread', 'Outbound-only thread in the shared project', '2024-03-07 10:00:00+00',
     false, true, false, false, NOW(), NOW());
