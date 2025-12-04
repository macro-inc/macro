-- Link (The User)
INSERT INTO public.email_links (id, macro_id, fusionauth_user_id, email_address, provider)
VALUES ('00000000-0000-0000-0000-000000000001', 'user_1', 'fa_user_1', 'user@example.com', 'GMAIL');

-- Contacts
INSERT INTO public.email_contacts (id, link_id, email_address, name) VALUES
                                                                         ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000001', 'known_a@example.com', 'Known Contact A'),
                                                                         ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000001', 'unknown_b@example.com', 'Unknown Contact B'),
                                                                         ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000001', 'known_c@example.com', 'Known Contact C'),
                                                                         ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000001', 'user@example.com', 'Me');

-- Establish "Known" contacts logic:
-- The query looks for contacts the user has SENT emails TO.

-- 1. User sent email to Contact A (making A "known")
INSERT INTO public.email_threads (id, link_id) VALUES ('99999999-9999-9999-9999-999999999991', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, is_sent, from_contact_id) VALUES
    ('90000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999991', '00000000-0000-0000-0000-000000000001', true, '55555555-5555-5555-5555-555555555555');

INSERT INTO public.email_message_recipients (message_id, contact_id, recipient_type) VALUES
    ('90000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TO');

-- 2. User sent email to Contact C (making C "known")
INSERT INTO public.email_threads (id, link_id) VALUES ('99999999-9999-9999-9999-999999999992', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, is_sent, from_contact_id) VALUES
    ('90000000-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999992', '00000000-0000-0000-0000-000000000001', true, '55555555-5555-5555-5555-555555555555');

INSERT INTO public.email_message_recipients (message_id, contact_id, recipient_type) VALUES
    ('90000000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'TO');


-- Test Threads to Query Against

-- Thread 1: Incoming message from Contact A (Known) -> Should Match
INSERT INTO public.email_threads (id, link_id) VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, is_sent) VALUES
    ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- Thread 2: Incoming message from Contact B (Unknown) -> Should NOT Match
INSERT INTO public.email_threads (id, link_id) VALUES ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, is_sent) VALUES
    ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

-- Thread 3: Incoming message from Contact C (Known) -> Should Match
INSERT INTO public.email_threads (id, link_id) VALUES ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, is_sent) VALUES
    ('30000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

-- Thread 4: Mixed Thread. Contact B (Unknown) + Contact A (Known) -> Should Match (because A is there)
INSERT INTO public.email_threads (id, link_id) VALUES ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, created_at) VALUES
                                                                                            ('40000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2023-01-01 10:00:00Z'), -- Unknown B
                                                                                            ('40000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2023-01-01 11:00:00Z'); -- Known A