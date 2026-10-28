-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Lets the lifecycle claim check a link for pending cleanup or revocation without scanning the outbox.
CREATE INDEX CONCURRENTLY email_mailbox_lifecycle_outbox_prerequisites
    ON email_mailbox_lifecycle_outbox (link_id)
    WHERE (payload->>'kind') IN ('cleanup_microsoft_watches', 'revoke_microsoft_grant');
