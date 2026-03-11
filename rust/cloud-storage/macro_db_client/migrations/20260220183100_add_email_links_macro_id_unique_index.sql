-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS email_links_macro_id_uq
ON email_links (macro_id);
