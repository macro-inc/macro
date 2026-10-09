-- One interpretation of organization state for Gmail labels and Outlook folders.
-- A user category named INBOX/TRASH never becomes a folder on Outlook.
CREATE VIEW email_message_mailbox_facts AS
SELECT m.id,
    COALESCE((m.mailbox_state->>'in_inbox')::boolean, 'INBOX' = ANY(labels.provider_ids)) AS in_inbox,
    COALESCE((m.mailbox_state->>'in_trash')::boolean, 'TRASH' = ANY(labels.provider_ids)) AS in_trash,
    COALESCE((m.mailbox_state->>'in_junk')::boolean, 'SPAM' = ANY(labels.provider_ids)) AS in_junk,
    CASE WHEN m.mailbox_state IS NOT NULL THEN m.is_sent ELSE 'SENT' = ANY(labels.provider_ids) END AS in_sent,
    NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false) AS is_present,
    CASE WHEN m.mailbox_state IS NOT NULL THEN
        m.is_draft OR m.is_sent OR COALESCE(m.mailbox_state->>'attention', 'unknown') <> 'other'
    ELSE
        m.is_draft OR labels.names && ARRAY['CATEGORY_PERSONAL','SENT','DRAFT']
        OR NOT labels.names && ARRAY['CATEGORY_UPDATES','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_FORUMS']
    END AS provider_is_primary
FROM email_messages m
CROSS JOIN LATERAL (
    SELECT COALESCE(array_agg(l.provider_label_id), ARRAY[]::text[]) AS provider_ids,
        COALESCE(array_agg(l.name::text), ARRAY[]::text[]) AS names
    FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
    WHERE ml.message_id = m.id
) labels;

CREATE INDEX email_messages_provider_folder ON email_messages (link_id, provider_folder_id)
    WHERE provider_folder_id IS NOT NULL;
