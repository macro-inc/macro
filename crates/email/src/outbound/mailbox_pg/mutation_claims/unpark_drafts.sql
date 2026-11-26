WITH parent AS MATERIALIZED (
    SELECT sync_generation FROM email_links WHERE id=$1 AND is_sync_active
        AND mailbox_unavailable_at IS NULL AND provider IN ('OUTLOOK','IMAP')
), parked AS MATERIALIZED (
    SELECT d.message_id FROM parent p CROSS JOIN LATERAL (
        SELECT d.message_id FROM email_mailbox_drafts d
        WHERE d.link_id=$1 AND d.generation=p.sync_generation
            AND d.parked_at IS NOT NULL
        ORDER BY d.message_id LIMIT $2 FOR UPDATE OF d SKIP LOCKED
    ) d
)
UPDATE email_mailbox_drafts d SET parked_at=NULL
FROM parked p WHERE d.message_id=p.message_id
