-- Synthetic local Brain Email identity. Apply the held mailbox migrations first.
BEGIN;
DO $$
BEGIN
    IF current_database() <> 'macro_brain_email_fixture' THEN
        RAISE EXCEPTION 'Brain Email fixture requires its dedicated database';
    END IF;
END
$$;

INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('63e74f20-5f3a-4d94-98c9-bb35cb900011', 'brain-owner@example.com', 'brain-owner@example.com', 'fixture_brain_owner'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900012', 'brain-admin@example.com', 'brain-admin@example.com', 'fixture_brain_admin'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900013', 'brain-member@example.com', 'brain-member@example.com', 'fixture_brain_member'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900014', 'brain-teammate@example.com', 'brain-teammate@example.com', 'fixture_brain_agent')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES
    ('macro|brain-owner@example.com', 'brain-owner@example.com', '63e74f20-5f3a-4d94-98c9-bb35cb900011', false),
    ('macro|brain-admin@example.com', 'brain-admin@example.com', '63e74f20-5f3a-4d94-98c9-bb35cb900012', false),
    ('macro|brain-member@example.com', 'brain-member@example.com', '63e74f20-5f3a-4d94-98c9-bb35cb900013', false),
    ('macro|brain-teammate@example.com', 'brain-teammate@example.com', '63e74f20-5f3a-4d94-98c9-bb35cb900014', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO team (id, name, owner_id) VALUES
    ('63e74f20-5f3a-4d94-98c9-bb35cb900001', 'Brain Email fixture', 'macro|brain-owner@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_user (team_id, user_id, team_role) VALUES
    ('63e74f20-5f3a-4d94-98c9-bb35cb900001', 'macro|brain-owner@example.com', 'owner'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900001', 'macro|brain-admin@example.com', 'admin'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900001', 'macro|brain-member@example.com', 'member'),
    ('63e74f20-5f3a-4d94-98c9-bb35cb900001', 'macro|brain-teammate@example.com', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO team_agents (user_id, team_id, created_by, persona_seed) VALUES
    (
        'macro|brain-teammate@example.com',
        '63e74f20-5f3a-4d94-98c9-bb35cb900001',
        'macro|brain-owner@example.com',
        '{"creator_id":"macro|brain-owner@example.com","name":"Fixture teammate","job_description":"","personality":""}'
    )
ON CONFLICT (user_id) DO NOTHING;

-- The grant columns hold markers that satisfy the active-row constraint.
-- The local read projection selects no credential columns or ciphertext.
INSERT INTO agent_mailboxes (
    id, request_id, user_id, team_id, provider, provider_mailbox_id, address,
    grant_id, grant_key_ciphertext, grant_kms_key_id, grant_encryption_version, state
) VALUES (
    '63e74f20-5f3a-4d94-98c9-bb35cb900002',
    '63e74f20-5f3a-4d94-98c9-bb35cb900006',
    'macro|brain-teammate@example.com',
    '63e74f20-5f3a-4d94-98c9-bb35cb900001',
    'dead_simple', 'fixture-mailbox', 'fixture-inbox@example.org',
    'fixture-marker', decode('00', 'hex'), 'fixture-marker', 1, 'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_agent_inboxes (agent_user_id, team_id, request_id, mailbox_id, address, state, fake_provider)
VALUES (
    'macro|brain-teammate@example.com',
    '63e74f20-5f3a-4d94-98c9-bb35cb900001',
    '63e74f20-5f3a-4d94-98c9-bb35cb900006',
    '63e74f20-5f3a-4d94-98c9-bb35cb900002',
    'fixture-inbox@example.org', 'active', true
)
ON CONFLICT (agent_user_id) DO NOTHING;

COMMIT;
