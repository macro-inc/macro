-- Fixture for the denormalized email_threads.is_signal flag.
--
-- Filters: vip@corp.com is_important=true (address), corp.com
--   is_important=false (domain) — address beats domain.
--
-- Thread d201 (flag=false): message from plain sender, no labels — signal.
-- Thread d202 (flag=true, stale on purpose): only a CATEGORY_PROMOTIONS
--   message — sync should clear to noise.
-- Thread d203 (flag=false): one promotions message + one unlabeled message —
--   any-message semantics makes it signal.
-- Thread d204 (flag=false): only message is TRASH — stays noise.
-- Thread d205 (flag=false): promotions message from vip@corp.com — address
--   override wins over both the domain override and the depriority label.
-- Thread d206 (flag=false): unlabeled message from other@corp.com — domain
--   override (no address exception) forces noise.
-- Thread d207 (flag=false): draft with a promotions label — drafts are signal.
-- Thread d208 (flag=true, correct): promotions message + macro draft — the
--   draft is the only signal message; discarding it must flip the flag and
--   deflate the draft-inflated metadata (inbox_visible,
--   latest_inbound_message_ts — see the UPDATE at the bottom).

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000d01', 'macro|sigflag_user@example.com', '00000000-0000-0000-0000-000000000d01',
        'sigflag_user@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cd001', '00000000-0000-0000-0000-000000000d01', 'plain@example.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cd002', '00000000-0000-0000-0000-000000000d01', 'promo@newsletter.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cd003', '00000000-0000-0000-0000-000000000d01', 'vip@corp.com', NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cd004', '00000000-0000-0000-0000-000000000d01', 'other@corp.com', NOW(), NOW());

INSERT INTO email_filters (id, link_id, email_address, email_domain, is_important, created_at)
VALUES ('00000000-0000-0000-0000-0000000fd001', '00000000-0000-0000-0000-000000000d01', 'vip@corp.com', NULL, true, NOW()),
       ('00000000-0000-0000-0000-0000000fd002', '00000000-0000-0000-0000-000000000d01', NULL, 'corp.com', false, NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, created_at)
VALUES ('00000000-0000-0000-0000-0000000bd001', '00000000-0000-0000-0000-000000000d01', 'TRASH', 'TRASH', NOW()),
       ('00000000-0000-0000-0000-0000000bd002', '00000000-0000-0000-0000-000000000d01', 'CATEGORY_PROMOTIONS', 'CATEGORY_PROMOTIONS', NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-000000000d01', true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d204', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d205', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d206', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d207', '00000000-0000-0000-0000-000000000d01', true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d208', '00000000-0000-0000-0000-000000000d01', true, false, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d501', 'gid-d501', FALSE, '00000000-0000-0000-0000-0000000cd001', '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d502', 'gid-d502', FALSE, '00000000-0000-0000-0000-0000000cd002', '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d503', 'gid-d503', FALSE, '00000000-0000-0000-0000-0000000cd002', '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d504', '00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d504', 'gid-d504', FALSE, '00000000-0000-0000-0000-0000000cd001', '2025-01-05 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-00000000d204', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d505', 'gid-d505', FALSE, '00000000-0000-0000-0000-0000000cd001', '2025-01-05 14:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d506', '00000000-0000-0000-0000-00000000d205', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d506', 'gid-d506', FALSE, '00000000-0000-0000-0000-0000000cd003', '2025-01-05 15:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d507', '00000000-0000-0000-0000-00000000d206', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d507', 'gid-d507', FALSE, '00000000-0000-0000-0000-0000000cd004', '2025-01-05 16:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d508', '00000000-0000-0000-0000-00000000d207', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d508', 'gid-d508', FALSE, '00000000-0000-0000-0000-0000000cd002', '2025-01-05 17:00:00 +00:00',
        false, false, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d509', '00000000-0000-0000-0000-00000000d208', '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d509', 'gid-d509', FALSE, '00000000-0000-0000-0000-0000000cd002', '2025-01-05 18:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d510', '00000000-0000-0000-0000-00000000d208', '00000000-0000-0000-0000-000000000d01',
        NULL, NULL, FALSE, '00000000-0000-0000-0000-0000000cd001', '2025-01-05 19:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-00000000d502', '00000000-0000-0000-0000-0000000bd002'),
       ('00000000-0000-0000-0000-00000000d503', '00000000-0000-0000-0000-0000000bd002'),
       ('00000000-0000-0000-0000-00000000d505', '00000000-0000-0000-0000-0000000bd001'),
       ('00000000-0000-0000-0000-00000000d506', '00000000-0000-0000-0000-0000000bd002'),
       ('00000000-0000-0000-0000-00000000d508', '00000000-0000-0000-0000-0000000bd002'),
       ('00000000-0000-0000-0000-00000000d509', '00000000-0000-0000-0000-0000000bd002');

-- Saving d208's macro draft left the thread's metadata draft-inflated:
-- drafts count toward latest_inbound_message_ts (and inbox_visible, already
-- true above). Discarding the draft must reset both.
UPDATE email_threads
SET latest_inbound_message_ts = '2025-01-05 19:00:00 +00:00'
WHERE id = '00000000-0000-0000-0000-00000000d208';
