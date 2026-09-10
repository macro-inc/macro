-- no-transaction
-- Email-attachment dedupe looks up DocumentInstance by sha. Without this
-- index the query has to walk every live document for the owner.
-- Must stay a single statement: sqlx sends no-transaction migrations as
-- one batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_instance_sha
    ON "DocumentInstance" (sha);
