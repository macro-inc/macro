-- no-transaction
-- Consumed promotion receipts are retained; expiry cleanup must skip that growing history.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY imap_verifications_unconsumed_expiry
    ON imap_verifications(expires_at, id)
    WHERE consumed_by IS NULL;
