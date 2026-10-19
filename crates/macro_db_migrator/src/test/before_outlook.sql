INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES ('019a0000-0000-7000-8000-000000000001', 'outlook-migration', 'migration@example.com', 'migration-test');
INSERT INTO "User" (id, email, macro_user_id)
VALUES ('macro|migration@example.com', 'migration@example.com', '019a0000-0000-7000-8000-000000000001');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
VALUES ('019a0000-0000-7000-8000-000000000002', 'macro|migration@example.com', 'migration-test', 'migration@example.com', 'GMAIL');
INSERT INTO email_threads (id, link_id, provider_id)
VALUES ('019a0000-0000-7000-8000-000000000003', '019a0000-0000-7000-8000-000000000002', 'gmail-thread');
INSERT INTO email_messages (id, thread_id, link_id, provider_id, body_text, is_draft)
VALUES ('019a0000-0000-7000-8000-000000000004', '019a0000-0000-7000-8000-000000000003',
        '019a0000-0000-7000-8000-000000000002', 'gmail-message', 'retained Gmail body', true);
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key)
VALUES ('019a0000-0000-7000-8000-000000000005', '019a0000-0000-7000-8000-000000000004',
        'receipt.pdf', 'application/pdf', 'migration-sha', 42, 'retained-object');
INSERT INTO calendar_events (id, owner_id, source_link_id, ical_uid, canonical_source_kind, starts_at, ends_at)
VALUES ('019a0000-0000-7000-8000-000000000006', 'macro|migration@example.com',
        '019a0000-0000-7000-8000-000000000002', 'migration-event', 'google',
        '2026-10-20 10:00Z', '2026-10-20 11:00Z');
INSERT INTO calendar_event_occurrences (event_id, owner_id, occurrence_key, starts_at, ends_at)
VALUES ('019a0000-0000-7000-8000-000000000006', 'macro|migration@example.com', 'single',
        '2026-10-20 10:00Z', '2026-10-20 11:00Z');
INSERT INTO calendar_event_reminder_firings (event_id, occurrence_key, minutes_before, fire_at)
VALUES ('019a0000-0000-7000-8000-000000000006', 'single', 10, '2026-10-20 09:50Z');
INSERT INTO calendar_event_reminder_deliveries (id, event_id, occurrence_key, minutes_before, fire_at, sent_at)
VALUES ('019a0000-0000-7000-8000-000000000007', '019a0000-0000-7000-8000-000000000006',
        'single', 10, '2026-10-20 09:50Z', '2026-10-20 09:50Z');
