-- Provider observations remain separate from the latest accepted tag intent.
CREATE VIEW email_effective_message_labels AS
WITH candidates AS (
    SELECT message_id,label_id FROM email_message_labels
    UNION
    SELECT p.message_id,l.id FROM email_pending_mailbox_state p
        JOIN email_messages m ON m.id=p.message_id
        JOIN email_labels l ON l.link_id=m.link_id AND p.attribute='tag:'||l.provider_label_id
    WHERE p.desired='true'::jsonb
)
SELECT c.message_id,c.label_id FROM candidates c
JOIN email_labels l ON l.id=c.label_id
LEFT JOIN email_pending_mailbox_state p ON p.message_id=c.message_id AND p.attribute='tag:'||l.provider_label_id
WHERE COALESCE(p.desired='true'::jsonb,true)
    AND NOT EXISTS(SELECT 1 FROM email_mailbox_settings_work w WHERE w.link_id=l.link_id
        AND w.kind='delete_label' AND w.resource_key=l.provider_label_id AND w.completed_revision<w.revision);
CREATE INDEX email_mailbox_command_targets_message ON email_mailbox_command_targets(message_id);
