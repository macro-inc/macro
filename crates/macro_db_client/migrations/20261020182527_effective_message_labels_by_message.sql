SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- Provider observations remain separate from the latest accepted tag intent.
-- Each UNION ALL branch must stay a bare table: Postgres only pushes a caller's
-- join on message_id into the branches then, so thread and folder queries use
-- the message_id indexes instead of reading every message label.
CREATE OR REPLACE VIEW email_effective_message_labels AS
SELECT c.message_id, c.label_id
FROM (
    SELECT message_id, label_id FROM email_message_labels
    UNION ALL
    SELECT p.message_id, (
        SELECT l.id FROM email_messages m
        JOIN email_labels l ON l.link_id = m.link_id AND p.attribute = 'tag:' || l.provider_label_id
        WHERE m.id = p.message_id
            AND NOT EXISTS (
                SELECT 1 FROM email_message_labels o WHERE o.message_id = m.id AND o.label_id = l.id
            )
    )
    FROM email_pending_mailbox_state p
) c
JOIN email_labels l ON l.id = c.label_id
LEFT JOIN email_pending_mailbox_state p
    ON p.message_id = c.message_id AND p.attribute = 'tag:' || l.provider_label_id
WHERE COALESCE(p.desired = 'true'::jsonb, true)
    AND NOT EXISTS (
        SELECT 1 FROM email_mailbox_settings_work w
        WHERE w.link_id = l.link_id
            AND w.kind = 'delete_label'
            AND w.resource_key = l.provider_label_id
            AND w.completed_revision < w.revision
    );
