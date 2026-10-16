-- Failed local materialization/publication must yield to other conversations.
-- Provider acceptance stays immutable; these timestamps never make a reply sendable.
ALTER TABLE meta_messaging_send
    ADD COLUMN native_retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE meta_messaging_message
    ADD COLUMN native_retry_at timestamptz NOT NULL DEFAULT now();

-- These predicates match the recovery readers. The older effects index does not
-- cover the revision predicate and is replaced without changing table contracts.
DROP INDEX meta_messaging_pending_effects_idx;
CREATE INDEX meta_messaging_native_effect_retry_idx
    ON meta_messaging_message(native_retry_at, created_at, message_id)
    WHERE published_revision < effect_revision;
CREATE INDEX meta_messaging_native_send_retry_idx
    ON meta_messaging_send(native_retry_at, id)
    WHERE provider_message_id IS NOT NULL
        AND state IN ('accepted', 'sent', 'delivered', 'read', 'failed');
