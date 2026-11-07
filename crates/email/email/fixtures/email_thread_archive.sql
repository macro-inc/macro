-- Extend the two-inbox fixture with canonical inbound metadata and INBOX state.
UPDATE email_threads
SET latest_inbound_message_ts = '2025-01-01T11:00:00Z'
WHERE id IN ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('33333333-aaaa-aaaa-aaaa-333333333333', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
