-- Disconnecting the source must not silently unblock delivery of the destination.
-- Keep the operation facts until the destination's owner explicitly resolves them.
ALTER TABLE email_draft_transfers
    DROP CONSTRAINT email_draft_transfers_source_id_fkey,
    DROP CONSTRAINT email_draft_transfers_source_link_id_fkey;
