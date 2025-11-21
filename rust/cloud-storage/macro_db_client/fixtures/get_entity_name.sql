INSERT INTO macro_user (id, email, stripe_customer_id, username) VALUES
('11111111-1111-1111-1111-111111111111', 'user@user.com', 'cus_1234', 'user');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", macro_user_id) VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234', '11111111-1111-1111-1111-111111111111');

INSERT INTO "Document" ("id", "name", "fileType", "owner", "createdAt", "updatedAt")
VALUES
    ('11111111-1111-1111-1111-111111111111', 'document', 'pdf', 'macro|user@user.com', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO "Chat" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES
    ('11111111-1111-1111-1111-111111111111', 'chat', 'macro|user@user.com', '2019-10-16 01:01:00', '2019-10-16 01:01:00');

INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'channel', 'public', NULL, 'macro|user@user.com');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at,
                         updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'macro|user@user.com', '11111111-1111-1111-1111-111111111111',
        'user@user.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

-- Thread 1: used for condition 1 (is_sent = true)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        false,
        false,
        NOW(),
        NOW());

INSERT INTO email_messages (id,
                            thread_id,
                            link_id,
                            provider_id,
                            is_sent,
                            from_contact_id,
                            internal_date_ts,
                            has_attachments,
                            is_read,
                            is_starred,
                            is_draft,
                            created_at,
                            updated_at,
                            subject)
VALUES ('11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        'provider-msg-101',
        TRUE,
        NULL,
        NOW(),
        true,
        false,
        false,
        false,
        NOW(),
        NOW(),
        'subject');
