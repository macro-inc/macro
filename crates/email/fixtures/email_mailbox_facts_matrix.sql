-- Every combination of the inputs to email_message_mailbox_facts, layered on
-- email_dynamic_query.sql: provider mailbox_state (absent, or any mix of
-- in_inbox, in_trash, attention and provider_missing), the INBOX, TRASH and
-- IMPORTANT labels, pending in_trash and in_inbox intents, and drafts.
-- Three messages share each thread so views must pick the right latest message.

CREATE TEMP TABLE facts_matrix AS
SELECT row_number() OVER () AS n, s.state, labels.mask, pending_trash.desired AS pending_trash,
    pending_inbox.desired AS pending_inbox, drafts.is_draft
FROM (
    SELECT NULL::jsonb AS state
    UNION ALL
    SELECT jsonb_strip_nulls(jsonb_build_object('in_inbox', inbox, 'in_trash', trash, 'attention', attention, 'provider_missing', missing))
    FROM (VALUES (true), (false), (NULL::boolean)) inbox(inbox)
    CROSS JOIN (VALUES (true), (false), (NULL::boolean)) trash(trash)
    CROSS JOIN (VALUES ('primary'), ('other'), (NULL::text)) attention(attention)
    CROSS JOIN (VALUES (true), (NULL::boolean)) missing(missing)
) s
CROSS JOIN generate_series(0, 7) labels(mask)
CROSS JOIN (VALUES (NULL::jsonb), ('true'::jsonb), ('false'::jsonb), ('null'::jsonb)) pending_trash(desired)
CROSS JOIN (VALUES (NULL::jsonb), ('true'::jsonb), ('false'::jsonb), ('null'::jsonb)) pending_inbox(desired)
CROSS JOIN (VALUES (false), (true)) drafts(is_draft);

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, created_at, updated_at)
SELECT DISTINCT md5('facts-thread-' || n / 3)::uuid, 'facts-thread-' || n / 3, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, true, false, NOW(), NOW()
FROM facts_matrix;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, subject, internal_date_ts, mailbox_state, is_draft, created_at, updated_at)
SELECT md5('facts-message-' || n)::uuid, md5('facts-thread-' || n / 3)::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'facts-message-' || n, 'facts ' || n, '2024-06-01 00:00:00+00'::timestamptz + n * interval '1 minute', state, is_draft, NOW(), NOW()
FROM facts_matrix;

INSERT INTO email_message_labels (message_id, label_id)
SELECT md5('facts-message-' || n)::uuid, label_id
FROM facts_matrix
JOIN (VALUES
    (1, '10000001-0000-0000-0000-000000000001'::uuid),
    (2, '10000006-0000-0000-0000-000000000006'::uuid),
    (4, '10000002-0000-0000-0000-000000000002'::uuid)
) labels(bit, label_id) ON mask & bit <> 0;

INSERT INTO email_mailbox_commands (id, link_id, generation, actor_id, intent, status)
VALUES ('cccccccc-0000-0000-0000-0000000000fa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'macro|user1@test.com', '{}'::jsonb, 'pending');

INSERT INTO email_pending_mailbox_state (message_id, attribute, command_id, desired)
SELECT md5('facts-message-' || n)::uuid, 'in_trash', 'cccccccc-0000-0000-0000-0000000000fa'::uuid, pending_trash
FROM facts_matrix WHERE pending_trash IS NOT NULL
UNION ALL
SELECT md5('facts-message-' || n)::uuid, 'in_inbox', 'cccccccc-0000-0000-0000-0000000000fa'::uuid, pending_inbox
FROM facts_matrix WHERE pending_inbox IS NOT NULL;

DROP TABLE facts_matrix;

ANALYZE email_threads, email_messages, email_message_labels, email_labels, email_pending_mailbox_state;
