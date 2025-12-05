-- Link
INSERT INTO public.email_links (id, macro_id, fusionauth_user_id, email_address, provider)
VALUES ('00000000-0000-0000-0000-000000000001', 'user_1', 'fa_user_1', 'test@example.com', 'GMAIL');

-- Contacts
INSERT INTO public.email_contacts (id, link_id, email_address, name) VALUES
                                                                         ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000001', 'sender1@example.com', 'Sender One'),
                                                                         ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000001', 'sender2@example.com', 'Sender Two');

-- Thread 1: Has table HTML, single sender, NO calendar invite
INSERT INTO public.email_threads (id, link_id) VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, body_html_sanitized) VALUES
    ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '<div><table><tr><td>Data</td></tr></table></div>');

-- Thread 2: No table, HAS calendar invite, multiple senders
INSERT INTO public.email_threads (id, link_id) VALUES ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, body_html_sanitized) VALUES
                                                                                                     ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '<p>Here is the invite</p>'),
                                                                                                     ('20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '<p>Thanks</p>');

INSERT INTO public.email_attachments (id, message_id, mime_type, filename) VALUES
    ('20000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'application/ics', 'invite.ics');

-- Thread 3: Duplicate sender test (same contact sends multiple messages), plain text
INSERT INTO public.email_threads (id, link_id) VALUES ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.email_messages (id, thread_id, link_id, from_contact_id, body_html_sanitized) VALUES
                                                                                                     ('30000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Message 1'),
                                                                                                     ('30000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Message 2');