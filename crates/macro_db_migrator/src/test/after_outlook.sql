DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM email_messages m JOIN email_links l ON l.id = m.link_id
        WHERE m.provider_id = 'gmail-message' AND m.body_text = 'retained Gmail body'
          AND m.mailbox_state IS NULL AND m.provider_folder_id IS NULL
          AND l.provider = 'GMAIL' AND l.sync_generation = 1
    ) THEN RAISE EXCEPTION 'Existing Gmail message or link changed'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM email_attachments_drafts
        WHERE s3_key = 'retained-object' AND size = 42 AND NOT upload_pending
    ) THEN RAISE EXCEPTION 'Existing draft attachment changed'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM calendar_event_reminder_deliveries
        WHERE id = '019a0000-0000-7000-8000-000000000007'
          AND method = 'popup' AND sent_at = '2026-10-20 09:50Z'
    ) THEN RAISE EXCEPTION 'Existing reminder delivery changed'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM calendar_event_reminder_firings
        WHERE event_id = '019a0000-0000-7000-8000-000000000006' AND method = 'popup'
    ) THEN RAISE EXCEPTION 'Existing reminder firing changed'; END IF;
    IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname IN ('email_messages_provider_folder', 'email_links_outlook_identity',
            'email_draft_upload_expiration', 'email_attachments_drafts_s3_key',
            'calendar_event_sources_provider_idx', 'calendar_event_reminder_firings_pkey',
            'calendar_reminder_delivery_identity') AND i.indisvalid AND i.indisready) <> 7
    THEN RAISE EXCEPTION 'An online index is missing or invalid'; END IF;
    IF (SELECT count(*) FROM pg_constraint
        WHERE convalidated AND conrelid <> 'microsoft_oauth_grant_versions'::regclass
        AND conname IN (
        'microsoft_oauth_grants_generation_check', 'microsoft_oauth_grants_revision_check',
        'email_links_sync_generation_check', 'calendar_accounts_provider_check',
        'calendar_event_sources_source_kind_check', 'calendar_event_sources_shape',
        'calendar_events_canonical_source_kind_check', 'calendar_events_conference_provider_check',
        'calendar_event_reminder_firings_method_check', 'calendar_event_reminder_deliveries_method_check')) <> 10
    THEN RAISE EXCEPTION 'A shared-table check was not validated'; END IF;
END $$;

-- Shared immutable attachment bytes and the two reminder methods must retain
-- the same semantics after replacing the indexes and constraints.
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key)
SELECT '019a0000-0000-7000-8000-000000000008', draft_id, file_name, content_type, sha, size, s3_key
FROM email_attachments_drafts WHERE id = '019a0000-0000-7000-8000-000000000005';
INSERT INTO calendar_event_reminder_firings (event_id, occurrence_key, minutes_before, fire_at, method)
SELECT event_id, occurrence_key, minutes_before, fire_at, 'email'
FROM calendar_event_reminder_firings WHERE event_id = '019a0000-0000-7000-8000-000000000006';
INSERT INTO calendar_event_reminder_deliveries (id, event_id, occurrence_key, minutes_before, fire_at, method)
SELECT '019a0000-0000-7000-8000-000000000009', event_id, occurrence_key, minutes_before, fire_at, 'email'
FROM calendar_event_reminder_deliveries WHERE id = '019a0000-0000-7000-8000-000000000007';
