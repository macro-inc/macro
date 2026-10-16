-- Derived routing metadata only. No customer channels or documents are converted.
ALTER TABLE meta_messaging_receipt ADD COLUMN routing_keys text[] NOT NULL DEFAULT '{}';
CREATE INDEX meta_messaging_receipt_active_routing_idx
    ON meta_messaging_receipt USING gin (routing_keys) WHERE status = 'processing';
CREATE INDEX meta_messaging_send_conversation_order_idx
    ON meta_messaging_send (connection_id, channel_id, created_at, id)
    WHERE state IN ('pending', 'sending');
CREATE INDEX meta_messaging_send_active_lease_idx
    ON meta_messaging_send (lease_until, id) WHERE state = 'sending';
