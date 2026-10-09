ALTER TABLE email_mailbox_command_targets
    ADD COLUMN message_id uuid REFERENCES email_messages(id) ON DELETE CASCADE,
    ADD COLUMN pending jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE email_mailbox_command_targets t SET message_id = m.id
    FROM email_mailbox_commands c, email_messages m
    WHERE c.id = t.command_id AND m.link_id = c.link_id AND m.provider_id = t.provider_id;
ALTER TABLE email_mailbox_command_targets DROP CONSTRAINT email_mailbox_command_targets_pkey;
ALTER TABLE email_mailbox_command_targets ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE email_mailbox_command_targets ALTER COLUMN message_id SET NOT NULL;
ALTER TABLE email_mailbox_command_targets ADD PRIMARY KEY (command_id,message_id);
ALTER TABLE email_mailbox_commands ADD COLUMN attempts integer NOT NULL DEFAULT 0;

-- Latest accepted intent wins per attribute, without overwriting provider facts.
CREATE TABLE email_pending_mailbox_state (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    attribute text NOT NULL,
    command_id uuid NOT NULL REFERENCES email_mailbox_commands(id) ON DELETE CASCADE,
    desired jsonb NOT NULL,
    PRIMARY KEY (message_id,attribute)
);
CREATE INDEX email_pending_mailbox_state_command ON email_pending_mailbox_state(command_id);

-- One interpretation of organization state for Gmail labels and Outlook folders.
-- A user category named INBOX/TRASH never becomes a folder on Outlook.
CREATE OR REPLACE VIEW email_message_mailbox_facts AS
SELECT m.id,
    COALESCE((pending.state->>'in_inbox')::boolean, (m.mailbox_state->>'in_inbox')::boolean, 'INBOX' = ANY(labels.provider_ids)) AS in_inbox,
    COALESCE((pending.state->>'in_trash')::boolean, (m.mailbox_state->>'in_trash')::boolean, 'TRASH' = ANY(labels.provider_ids)) AS in_trash,
    COALESCE((pending.state->>'in_junk')::boolean, (m.mailbox_state->>'in_junk')::boolean, 'SPAM' = ANY(labels.provider_ids)) AS in_junk,
    CASE WHEN m.mailbox_state IS NOT NULL THEN m.is_sent ELSE 'SENT' = ANY(labels.provider_ids) END AS in_sent,
    NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false) AS is_present,
    CASE WHEN m.mailbox_state IS NOT NULL THEN
        m.is_draft OR m.is_sent OR COALESCE(m.mailbox_state->>'attention', 'unknown') <> 'other'
    ELSE
        m.is_draft OR labels.names && ARRAY['CATEGORY_PERSONAL','SENT','DRAFT']
        OR NOT labels.names && ARRAY['CATEGORY_UPDATES','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_FORUMS']
    END AS provider_is_primary,
    CASE WHEN m.mailbox_state IS NOT NULL THEN
        m.mailbox_state->>'attention' = 'primary'
    ELSE 'IMPORTANT' = ANY(labels.provider_ids) END AS provider_is_important,
    CASE WHEN m.mailbox_state IS NOT NULL THEN
        m.mailbox_state->>'attention' = 'other'
    ELSE labels.provider_ids && ARRAY['CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_FORUMS']
    END AS provider_is_other
FROM email_messages m
CROSS JOIN LATERAL (
    SELECT jsonb_object_agg(p.attribute,p.desired) AS state
    FROM email_pending_mailbox_state p WHERE p.message_id = m.id
) pending
CROSS JOIN LATERAL (
    SELECT COALESCE(array_agg(l.provider_label_id), ARRAY[]::text[]) AS provider_ids,
        COALESCE(array_agg(l.name::text), ARRAY[]::text[]) AS names
    FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
    WHERE ml.message_id = m.id
) labels;
