-- Domain suppression is per-address: bob's email-level false does not suppress alice's domain-level true.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|alice@company.com', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@company.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@company.com', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts, has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'provider-dddddddd-dddd-dddd-dddd-dddddddddddd', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NOW(), false, false, false, false, NOW(), NOW());

INSERT INTO email_filters (link_id, email_address, email_domain, is_important)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'company.com', true);

INSERT INTO email_filters (link_id, email_address, email_domain, is_important)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bob@company.com', NULL, false);
