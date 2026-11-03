-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Columns follow the ORDER BY of the photo claim so it reads the first due row.
CREATE INDEX CONCURRENTLY email_address_book_sources_photo_claim
    ON email_address_book_sources (photo_due_at, link_id, folder_id, provider_id)
    WHERE deleted_at IS NULL;
