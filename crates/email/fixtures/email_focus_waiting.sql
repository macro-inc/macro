-- Fixture for the Focus repository (email crate, outbound/focus_pg), loaded
-- after email_focus. Inbox state comes from each message's labels: tests run
-- recompute_thread_metadata, so visibility and timestamps are what ingestion
-- would store, not what a fixture asserts.
--
-- Thread f301: Casey wrote 10 days ago, the owner answered 5 days ago.
-- Thread f302: Casey wrote 3 days ago, the owner answered yesterday.
-- Thread f303: as f301, but marked Done: the incoming mail lost its INBOX label.
-- Thread f304: as f301, but the owner's answer only says "Thanks!".
-- Thread f305: only the owner's own message, sent 5 days ago.
-- Threads f306 to f309 come from someone the owner never wrote to, so only what
-- the thread itself is can bring them in:
-- Thread f306: a reschedule (METHOD:REQUEST) filed under Updates.
-- Thread f307: an RSVP (METHOD:REPLY) filed under Updates.
-- Thread f308: plain mail filed under Updates.
-- Thread f309: a calendar file nothing parsed, filed under Updates.
-- Thread f30a: mail from Casey, whom the owner wrote to lately, filed under Updates.

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf006', '00000000-0000-0000-0000-000000000f01', 'weekly@numbers.example', NULL, NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, created_at)
VALUES ('00000000-0000-0000-0000-0000000bf002', '00000000-0000-0000-0000-000000000f01', 'INBOX', 'INBOX', NOW()),
       ('00000000-0000-0000-0000-0000000bf003', '00000000-0000-0000-0000-000000000f01', 'SENT', 'SENT', NOW()),
       ('00000000-0000-0000-0000-0000000bf004', '00000000-0000-0000-0000-000000000f01', 'CATEGORY_UPDATES', 'CATEGORY_UPDATES', NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal, created_at, updated_at)
SELECT ('00000000-0000-0000-0000-00000000f30' || n)::uuid, '00000000-0000-0000-0000-000000000f01', false, true, false, NOW(), NOW()
FROM unnest(ARRAY['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a']) AS n;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            subject, body_text, has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f611', '00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-000000000f01',
        'p-f611', 'g-f611', false, '00000000-0000-0000-0000-0000000cf001', NOW() - INTERVAL '10 days',
        'Contract', 'Here is the contract.', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f612', '00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-000000000f01',
        'p-f612', 'g-f612', true, '00000000-0000-0000-0000-0000000cf002', NOW() - INTERVAL '5 days',
        'Re: Contract', 'Can you send the signed copy?', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f621', '00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-000000000f01',
        'p-f621', 'g-f621', false, '00000000-0000-0000-0000-0000000cf001', NOW() - INTERVAL '3 days',
        'Pilot', 'How is the pilot going?', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f622', '00000000-0000-0000-0000-00000000f302', '00000000-0000-0000-0000-000000000f01',
        'p-f622', 'g-f622', true, '00000000-0000-0000-0000-0000000cf002', NOW() - INTERVAL '1 day',
        'Re: Pilot', 'Well. When can we talk through the results?', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f631', '00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-000000000f01',
        'p-f631', 'g-f631', false, '00000000-0000-0000-0000-0000000cf001', NOW() - INTERVAL '10 days',
        'Old thread', 'Here is the report.', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f632', '00000000-0000-0000-0000-00000000f303', '00000000-0000-0000-0000-000000000f01',
        'p-f632', 'g-f632', true, '00000000-0000-0000-0000-0000000cf002', NOW() - INTERVAL '5 days',
        'Re: Old thread', 'Can you send last year too?', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f641', '00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-000000000f01',
        'p-f641', 'g-f641', false, '00000000-0000-0000-0000-0000000cf001', NOW() - INTERVAL '10 days',
        'Slides', 'Here are the slides.', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f642', '00000000-0000-0000-0000-00000000f304', '00000000-0000-0000-0000-000000000f01',
        'p-f642', 'g-f642', true, '00000000-0000-0000-0000-0000000cf002', NOW() - INTERVAL '5 days',
        'Re: Slides', 'Thanks!', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f651', '00000000-0000-0000-0000-00000000f305', '00000000-0000-0000-0000-000000000f01',
        'p-f651', 'g-f651', true, '00000000-0000-0000-0000-0000000cf002', NOW() - INTERVAL '5 days',
        'Hello', 'Are you free next week?', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f661', '00000000-0000-0000-0000-00000000f306', '00000000-0000-0000-0000-000000000f01',
        'p-f661', 'g-f661', false, '00000000-0000-0000-0000-0000000cf006', NOW() - INTERVAL '1 day',
        'Moved: Demo', '', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f671', '00000000-0000-0000-0000-00000000f307', '00000000-0000-0000-0000-000000000f01',
        'p-f671', 'g-f671', false, '00000000-0000-0000-0000-0000000cf006', NOW() - INTERVAL '1 day',
        'Aceptada: Demo', '', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f681', '00000000-0000-0000-0000-00000000f308', '00000000-0000-0000-0000-000000000f01',
        'p-f681', 'g-f681', false, '00000000-0000-0000-0000-0000000cf006', NOW() - INTERVAL '1 day',
        'Weekly numbers', 'Up and to the right.', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f6a1', '00000000-0000-0000-0000-00000000f30a', '00000000-0000-0000-0000-000000000f01',
        'p-f6a1', 'g-f6a1', false, '00000000-0000-0000-0000-0000000cf001', NOW() - INTERVAL '1 day',
        'Quarterly summary', 'For your records.', false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000f691', '00000000-0000-0000-0000-00000000f309', '00000000-0000-0000-0000-000000000f01',
        'p-f691', 'g-f691', false, '00000000-0000-0000-0000-0000000cf006', NOW() - INTERVAL '1 day',
        'See you there', '', true, true, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-00000000f611', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f612', '00000000-0000-0000-0000-0000000cf001', 'TO'),
       ('00000000-0000-0000-0000-00000000f621', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f622', '00000000-0000-0000-0000-0000000cf001', 'TO'),
       ('00000000-0000-0000-0000-00000000f631', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f632', '00000000-0000-0000-0000-0000000cf001', 'TO'),
       ('00000000-0000-0000-0000-00000000f641', '00000000-0000-0000-0000-0000000cf002', 'TO'),
       ('00000000-0000-0000-0000-00000000f642', '00000000-0000-0000-0000-0000000cf001', 'TO'),
       ('00000000-0000-0000-0000-00000000f651', '00000000-0000-0000-0000-0000000cf001', 'TO');

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-00000000f611', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f612', '00000000-0000-0000-0000-0000000bf003'),
       ('00000000-0000-0000-0000-00000000f621', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f622', '00000000-0000-0000-0000-0000000bf003'),
       -- f631 lost INBOX when the thread was marked Done.
       ('00000000-0000-0000-0000-00000000f632', '00000000-0000-0000-0000-0000000bf003'),
       ('00000000-0000-0000-0000-00000000f641', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f642', '00000000-0000-0000-0000-0000000bf003'),
       ('00000000-0000-0000-0000-00000000f651', '00000000-0000-0000-0000-0000000bf003'),
       ('00000000-0000-0000-0000-00000000f661', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f661', '00000000-0000-0000-0000-0000000bf004'),
       ('00000000-0000-0000-0000-00000000f671', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f671', '00000000-0000-0000-0000-0000000bf004'),
       ('00000000-0000-0000-0000-00000000f681', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f681', '00000000-0000-0000-0000-0000000bf004'),
       ('00000000-0000-0000-0000-00000000f691', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f691', '00000000-0000-0000-0000-0000000bf004'),
       ('00000000-0000-0000-0000-00000000f6a1', '00000000-0000-0000-0000-0000000bf002'),
       ('00000000-0000-0000-0000-00000000f6a1', '00000000-0000-0000-0000-0000000bf004');

INSERT INTO email_message_calendar_invites (message_id, component_id, snapshot)
VALUES ('00000000-0000-0000-0000-00000000f661', 'request-1', '{"method": "request"}'::jsonb),
       ('00000000-0000-0000-0000-00000000f671', 'reply-1', '{"method": "reply"}'::jsonb);

INSERT INTO email_attachments (id, message_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000000f991', '00000000-0000-0000-0000-00000000f691', 'invite.ics', 'text/calendar', NOW());

-- Maintained at ingestion; recompute_thread_metadata leaves it alone.
UPDATE email_threads
SET has_calendar_attachment = true
WHERE id IN ('00000000-0000-0000-0000-00000000f306',
             '00000000-0000-0000-0000-00000000f307',
             '00000000-0000-0000-0000-00000000f309');
