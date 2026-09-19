-- Fixture for the denormalized email_threads.is_signal flag (email crate):
-- filter-change fan-out resync and the update_thread_metadata piggyback.
--
-- Thread e201 (is_signal=true, correct): unlabeled message from
--   plain@example.com — muting/unmuting that sender flips the flag.
-- Thread e202 (is_signal=false, correct): CATEGORY_PROMOTIONS message from
--   promo@newsletter.com — marking the domain important flips it to signal.
-- Thread e203 (is_signal=true, stale on purpose): only a CATEGORY_PROMOTIONS
--   message — update_thread_metadata must clear it.
-- Thread e204 (is_signal=true, correct): promotions message + macro draft —
--   discarding the draft via delete_draft_message must flip the flag and
--   deflate the draft-inflated metadata (see the UPDATE at the bottom).
-- Thread e205 (is_signal=true, correct): unlabeled message from
--   other@example.com — same domain as e201's sender but no address
--   exception, for the domain-mute fan-out tests.
-- Thread e206 (is_signal=true, correct): SENT-only message + macro draft —
--   a done sent thread the draft resurfaced into the inbox; discarding the
--   draft must send it back out of the inbox (is_signal stays true via the
--   SENT label, but inbox_visible/latest_inbound_message_ts reset).

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e01', 'macro|sigflag_email@example.com', '00000000-0000-0000-0000-000000000e01',
        'sigflag_email@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ce001', '00000000-0000-0000-0000-000000000e01', 'plain@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000ce002', '00000000-0000-0000-0000-000000000e01', 'promo@newsletter.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000ce003', '00000000-0000-0000-0000-000000000e01', 'other@example.com', NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, created_at)
VALUES ('00000000-0000-0000-0000-0000000be001', '00000000-0000-0000-0000-000000000e01', 'CATEGORY_PROMOTIONS', 'CATEGORY_PROMOTIONS', NOW()),
       ('00000000-0000-0000-0000-0000000be002', '00000000-0000-0000-0000-000000000e01', 'SENT', 'SENT', NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000e01', true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-000000000e01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e203', '00000000-0000-0000-0000-000000000e01', true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-000000000e01', true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e205', '00000000-0000-0000-0000-000000000e01', true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e206', '00000000-0000-0000-0000-000000000e01', true, true, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e501', 'gid-e501', FALSE, '00000000-0000-0000-0000-0000000ce001', '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e502', 'gid-e502', FALSE, '00000000-0000-0000-0000-0000000ce002', '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-00000000e203', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e503', 'gid-e503', FALSE, '00000000-0000-0000-0000-0000000ce002', '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e504', '00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e504', 'gid-e504', FALSE, '00000000-0000-0000-0000-0000000ce002', '2025-01-05 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e505', '00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-000000000e01',
        NULL, NULL, FALSE, '00000000-0000-0000-0000-0000000ce001', '2025-01-05 14:00:00 +00:00',
        false, false, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e506', '00000000-0000-0000-0000-00000000e205', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e506', 'gid-e506', FALSE, '00000000-0000-0000-0000-0000000ce003', '2025-01-05 15:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e507', '00000000-0000-0000-0000-00000000e206', '00000000-0000-0000-0000-000000000e01',
        'provider-msg-e507', 'gid-e507', TRUE, '00000000-0000-0000-0000-0000000ce001', '2025-01-05 16:00:00 +00:00',
        false, true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000e508', '00000000-0000-0000-0000-00000000e206', '00000000-0000-0000-0000-000000000e01',
        NULL, NULL, FALSE, '00000000-0000-0000-0000-0000000ce001', '2025-01-05 17:00:00 +00:00',
        false, true, false, true, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-0000000be001'),
       ('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-0000000be001'),
       ('00000000-0000-0000-0000-00000000e504', '00000000-0000-0000-0000-0000000be001'),
       ('00000000-0000-0000-0000-00000000e507', '00000000-0000-0000-0000-0000000be002');

-- Saving the macro drafts left e204's and e206's metadata draft-inflated:
-- drafts count toward latest_inbound_message_ts (and inbox_visible, already
-- true above). Discarding each draft must reset both.
UPDATE email_threads
SET latest_inbound_message_ts = '2025-01-05 14:00:00 +00:00'
WHERE id = '00000000-0000-0000-0000-00000000e204';
UPDATE email_threads
SET latest_inbound_message_ts = '2025-01-05 17:00:00 +00:00'
WHERE id = '00000000-0000-0000-0000-00000000e206';
