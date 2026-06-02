-- Add-on to email_dynamic_query_crm_dedupe.sql (load both).
--
-- Faye is NOT on Team Beta but has her own copy of conversation X (same
-- root global_id '<x-1@acme.com>'), directly shared with Dave via
-- entity_access. Under team scope + SharedEmailFilter::Include her copy
-- enters through the Shared candidate branch and must collapse into
-- Dave's own copy (td1). Her thread ts (14:00) is the newest of all X
-- copies, so a dedupe failure would surface it at the top of the list.

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('f1111111-1111-1111-1111-111111111111', 'faye@out.com', 'faye@out.com', 'stripe_faye');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES
    ('macro|faye@out.com', 'faye@out.com', 'Faye', 'f1111111-1111-1111-1111-111111111111');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('d0000003-0000-0000-0000-000000000003', 'macro|faye@out.com', 'fa_faye', 'faye@out.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('c1000003-0000-0000-0000-000000000003', 'd0000003-0000-0000-0000-000000000003', 'vendor@acme.com', 'Vendor', NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('77770003-0000-0000-0000-000000000001', 'd0000003-0000-0000-0000-000000000003', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('77770003-0000-0000-0000-000000000002', 'd0000003-0000-0000-0000-000000000003', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- tf1: faye's copy of conversation X
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('55550003-0000-0000-0000-000000000001', 'tf1', 'd0000003-0000-0000-0000-000000000003',
     true, false, '2026-05-01 14:00:00+00', NULL, '2026-05-01 14:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts, global_id,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('66660003-0000-0000-0000-000000000001', '55550003-0000-0000-0000-000000000001',
     'd0000003-0000-0000-0000-000000000003', 'mf1', 'c1000003-0000-0000-0000-000000000003',
     'Conv X', 'x root (faye copy)', '2026-05-01 08:00:00+00', '<x-1@acme.com>',
     false, false, false, false, NOW(), NOW()),
    ('66660003-0000-0000-0000-000000000002', '55550003-0000-0000-0000-000000000001',
     'd0000003-0000-0000-0000-000000000003', 'mf2', 'c1000003-0000-0000-0000-000000000003',
     'Conv X', 'x reply (faye only)', '2026-05-01 14:00:00+00', '<x-3@acme.com>',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('66660003-0000-0000-0000-000000000001', '77770003-0000-0000-0000-000000000001'),
    ('66660003-0000-0000-0000-000000000002', '77770003-0000-0000-0000-000000000001');

-- Direct share of faye's thread with dave
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES
    ('55550003-0000-0000-0000-000000000001'::uuid, 'thread', 'macro|dave@beta.com', 'user', 'view');
