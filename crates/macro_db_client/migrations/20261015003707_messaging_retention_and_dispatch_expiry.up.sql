ALTER TABLE meta_messaging_send
    ADD COLUMN tracked_lease_id uuid,
    ADD COLUMN dispatch_started_at timestamptz;
-- Matching the current lease, rather than a boolean, distinguishes an older
-- worker's subsequent claim during a rolling deployment. Untracked claims stay uncertain.
CREATE INDEX meta_messaging_send_expiry_idx ON meta_messaging_send(created_at,id)
    WHERE state='pending' OR (state='sending' AND dispatch_started_at IS NULL);

ALTER TABLE meta_messaging_receipt
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN payload_cleared_at timestamptz;
CREATE INDEX meta_messaging_receipt_retention_idx ON meta_messaging_receipt(created_at,id)
    WHERE payload_cleared_at IS NULL;
CREATE INDEX meta_messaging_receipt_completed_retention_idx ON meta_messaging_receipt(completed_at,id)
    WHERE status='complete' AND decode_failures=0 AND payload_cleared_at IS NULL;
CREATE INDEX meta_messaging_receipt_metadata_retention_idx ON meta_messaging_receipt(created_at,id)
    WHERE payload_cleared_at IS NOT NULL;

-- Opaque copies live in the existing email attachment bucket's isolated temp/
-- namespace. Reserve cleanup before uploading any bytes; never reference a user.
CREATE TABLE meta_messaging_media_copy (
    id uuid PRIMARY KEY,
    bucket text NOT NULL,
    delete_after timestamptz NOT NULL DEFAULT now()+interval '1 day',
    available_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
    lease_id uuid,
    lease_until timestamptz
);
CREATE INDEX meta_messaging_media_copy_cleanup_idx ON meta_messaging_media_copy(available_at,id);
